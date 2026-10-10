import { fetchFile } from '@ffmpeg/util'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { onAbort, throwIfCancelled } from './cancellation'
import { SubtitleCue } from './subtitleCues'
import { SubtitlePosition, clampedSubtitleY } from './subtitlePosition'
import { OUTPUT_FRAME_RATE, OUTPUT_HEIGHT, OUTPUT_WIDTH, canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { burnSubtitlesWebCodecs } from './webcodecs/burnSubtitlesWebCodecs'
import { normalizeShotWebCodecs } from './webcodecs/normalizeShot'
import type { SubtitleOverlay } from './webcodecs/subtitleOverlay'
import {
  hasFirstShotExtras,
  punchInPlan,
  styleCues,
  ZOOM_ANCHOR_Y,
  type HookOptions,
  type PunchInPlan,
  type StyledCue,
} from './subtitleHook'
import { EMPHASIS_COLOR, type Run } from './subtitleEmphasis'
import {
  EMOJI_FONT_FAMILY,
  STICKER_CENTER_X,
  STICKER_CENTER_Y,
  STICKER_EMOJI_PX,
  STICKER_IMAGE_HEIGHT,
  STICKER_OUTLINE_PX,
  STICKER_ROTATION_DEG,
  STICKER_SHADOW,
  stickerOf,
  stripStickers,
} from './subtitleSticker'
import {
  EN_STYLE,
  JA_STYLE,
  SUBTITLE_BLOCK_GAP,
  SUBTITLE_PADDING_Y,
  SUBTITLE_REFERENCE_WIDTH,
  SUBTITLE_SHADOW,
  TextBlockLayout,
  fontFor,
  layoutCue,
  outlineWidth,
  type MeasureText,
} from './subtitleLayout'

/**
 * Build the chained overlay filtergraph for one subtitle image input per
 * entry of `ys` (indices 1..ys.length, input 0 is the base video), each
 * composited horizontally centered at its own Y (images differ in height
 * with their line count). Each image input is itself time-bounded via
 * `-loop 1 -t <duration>` and an `-itsoffset <start>` at the ffmpeg-input
 * level (see burnSubtitles below), so no `enable=` time-window expression is
 * needed here — simpler and less error-prone than threading per-overlay timing
 * through the filter string itself. `baseFilter` (the zoom in) is applied
 * to the video first, under the overlays.
 */
export function buildOverlayFilterGraph(ys: number[], baseFilter?: string): { filterGraph: string; outputLabel: string } {
  const base = baseFilter ? '[base]' : '[0:v]'
  const prelude = baseFilter ? [`[0:v]${baseFilter}[base]`] : []
  if (ys.length === 0) {
    return { filterGraph: prelude.join(';'), outputLabel: base }
  }

  const stages = ys.map((y, i) => {
    const baseInput = i === 0 ? base : `[v${i - 1}]`
    return `${baseInput}[sub${i}]overlay=x=(W-w)/2:y=${y}[v${i}]`
  })

  return { filterGraph: [...prelude, ...stages].join(';'), outputLabel: `[v${ys.length - 1}]` }
}

/**
 * ffmpeg's zoom, as punchInScale does it on the hardware path, about
 * (50%, ZOOM_ANCHOR_Y): pushing in from 1x at `at` to `zoom` at `until`, or
 * (direction 'out') held at `zoom` until `at`, then pulled back to 1x at
 * `until`. `in` counts input frames of the joined video, which is
 * normalized to OUTPUT_FRAME_RATE; +0.5 takes the frame's midpoint, as the
 * hardware path does. zoompan crops to whole pixels, so the slow zoom may
 * judder slightly — accepted on this last-resort path, which has no impact
 * effect.
 */
export function punchInFilter({ punchIn, until }: PunchInPlan): string {
  const t = `(in+0.5)/${OUTPUT_FRAME_RATE}`
  const at = punchIn.at.toFixed(3)
  const span = (until - punchIn.at).toFixed(3)
  const amount = (punchIn.zoom - 1).toFixed(2)
  const progress = `(${t}-${at})/${span}`
  const z = punchIn.direction === 'out'
    ? `if(lt(${t},${at}),${punchIn.zoom.toFixed(2)},if(lt(${t},${until.toFixed(3)}),${punchIn.zoom.toFixed(2)}-${amount}*${progress},1))`
    : `if(lt(${t},${at}),1,if(lt(${t},${until.toFixed(3)}),1+${amount}*${progress},1))`
  return `zoompan=z='${z}':x='iw/2-iw/zoom/2':y='ih*${ZOOM_ANCHOR_Y}-ih*${ZOOM_ANCHOR_Y}/zoom'`
    + `:d=1:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:fps=${OUTPUT_FRAME_RATE}`
}

/** How subtitles look beyond the cues themselves. */
export interface SubtitleLook {
  /** 0-100, where normal cues are centered. */
  position: SubtitlePosition
  hook: HookOptions
  /**
   * The first shot's length, when this video starts with it (the whole
   * joined video, or the first shot's own clip); null for any other shot.
   */
  firstShotDuration: number | null
}

/** Where a cue is centered: hook cues have a position of their own. */
export function cuePosition(cue: StyledCue, look: SubtitleLook): SubtitlePosition {
  return cue.variant === 'hook' ? look.hook.position : look.position
}

/**
 * Draw one line's runs centered on `centerX`: first every run's black
 * outline under a soft shadow, then the fills (white, emphasis yellow)
 * without one, so the outline sits under the letters and never thins them.
 */
function drawOutlinedRuns(ctx: CanvasRenderingContext2D, runs: Run[], centerX: number, y: number, fontPx: number) {
  const widths = runs.map(run => ctx.measureText(run.text).width)
  const left = centerX - widths.reduce((sum, w) => sum + w, 0) / 2

  ctx.save()
  ctx.shadowColor = SUBTITLE_SHADOW.color
  ctx.shadowBlur = fontPx * SUBTITLE_SHADOW.blurRatio
  ctx.shadowOffsetY = fontPx * SUBTITLE_SHADOW.offsetYRatio
  ctx.strokeStyle = '#000'
  ctx.lineWidth = outlineWidth(fontPx)
  ctx.lineJoin = 'round'
  let x = left
  runs.forEach((run, i) => {
    ctx.strokeText(run.text, x, y)
    x += widths[i]
  })
  ctx.restore()

  x = left
  runs.forEach((run, i) => {
    ctx.fillStyle = run.emphasized ? EMPHASIS_COLOR : '#ffffff'
    ctx.fillText(run.text, x, y)
    x += widths[i]
  })
}

/** Text measurement on a scratch canvas, matching what gets drawn. */
function canvasMeasure(): MeasureText {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  return (text, font) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
}

/** A video-wide transparent canvas `height` tall, set up for drawing runs. */
function overlayCanvas(height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = SUBTITLE_REFERENCE_WIDTH
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  // Runs are laid side by side from the left, centered as a whole line.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  return { canvas, ctx }
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to render subtitle image'))
    }, 'image/png')
  })
}

/**
 * Render one cue's subtitle (English above, Japanese smaller below) as a
 * transparent PNG as wide as the video and
 * exactly as tall as its layout: white outlined text, no box. Text is
 * wrapped onto balanced lines (see subtitleLayout); `*emphasized*` words are
 * yellow.
 */
export async function renderCueImage(cue: SubtitleCue): Promise<{ image: Blob; height: number }> {
  const layout = layoutCue(cue, canvasMeasure())
  const width = SUBTITLE_REFERENCE_WIDTH
  const { canvas, ctx } = overlayCanvas(layout.height)

  let top = SUBTITLE_PADDING_Y
  const drawBlock = (block: TextBlockLayout, font: string) => {
    ctx.font = font
    for (const runs of block.runs) {
      drawOutlinedRuns(ctx, runs, width / 2, top + block.lineHeightPx / 2, block.fontPx)
      top += block.lineHeightPx
    }
  }
  drawBlock(layout.en, fontFor(EN_STYLE, layout.en.fontPx))
  if (layout.ja) {
    top += SUBTITLE_BLOCK_GAP
    drawBlock(layout.ja, fontFor(JA_STYLE, layout.ja.fontPx))
  }
  return { image: await toPng(canvas), height: layout.height }
}

/** A square canvas `size` px wide with a 2D context. */
function squareCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  return { canvas, ctx }
}

/**
 * Render the first shot's sticker: the emoji, big, with a white die-cut
 * border and a soft shadow, tilted a little, on a transparent PNG as wide as
 * the video and STICKER_IMAGE_HEIGHT tall (centered on STICKER_CENTER_X).
 * The border is the emoji's own silhouette in white, stamped in a ring
 * around it, so it follows the shape rather than being a box.
 */
export async function renderStickerImage(emoji: string): Promise<{ image: Blob; height: number }> {
  const size = Math.ceil(STICKER_EMOJI_PX * 1.3) + STICKER_OUTLINE_PX * 2
  const center = size / 2

  const glyph = squareCanvas(size)
  glyph.ctx.font = `${STICKER_EMOJI_PX}px ${EMOJI_FONT_FAMILY}`
  glyph.ctx.textAlign = 'center'
  glyph.ctx.textBaseline = 'middle'
  glyph.ctx.fillText(emoji, center, center)

  const silhouette = squareCanvas(size)
  silhouette.ctx.drawImage(glyph.canvas, 0, 0)
  silhouette.ctx.globalCompositeOperation = 'source-in'
  silhouette.ctx.fillStyle = '#ffffff'
  silhouette.ctx.fillRect(0, 0, size, size)

  const sticker = squareCanvas(size)
  const steps = 24
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    sticker.ctx.drawImage(silhouette.canvas, Math.cos(a) * STICKER_OUTLINE_PX, Math.sin(a) * STICKER_OUTLINE_PX)
  }
  sticker.ctx.drawImage(glyph.canvas, 0, 0)

  const { canvas, ctx } = overlayCanvas(STICKER_IMAGE_HEIGHT)
  ctx.translate(SUBTITLE_REFERENCE_WIDTH * STICKER_CENTER_X, STICKER_IMAGE_HEIGHT / 2)
  ctx.rotate((STICKER_ROTATION_DEG * Math.PI) / 180)
  ctx.shadowColor = STICKER_SHADOW.color
  ctx.shadowBlur = STICKER_SHADOW.blur
  ctx.shadowOffsetY = STICKER_SHADOW.offsetY
  ctx.drawImage(sticker.canvas, -center, -center)

  for (const c of [glyph.canvas, silhouette.canvas, sticker.canvas]) {
    c.width = 0
    c.height = 0
  }
  return { image: await toPng(canvas), height: STICKER_IMAGE_HEIGHT }
}

/**
 * Render each cue that has a `ja` translation to its PNG and place it:
 * shown over [start, start + duration), centered on its position (the
 * hook position for hook cues) but kept fully on screen. Cues without a
 * translation aren't burned in. An emoji in a hook cue isn't drawn in its
 * text: it becomes the sticker, from 0 s to the end of the first shot.
 */
export async function renderSubtitleOverlays(cues: StyledCue[], look: SubtitleLook): Promise<SubtitleOverlay[]> {
  const overlays: SubtitleOverlay[] = []
  for (const cue of cues) {
    if (cue.ja === null) continue
    const drawn = cue.variant === 'hook' ? { ...cue, en: stripStickers(cue.en) } : cue
    const { image, height } = await renderCueImage(drawn)
    overlays.push({ start: cue.start, end: cue.start + cueDuration(cue), image, y: clampedSubtitleY(cuePosition(cue, look), height) })
  }
  const sticker = look.firstShotDuration !== null ? stickerOf(cues.filter(c => c.ja !== null)) : null
  if (sticker && look.firstShotDuration !== null) {
    const { image, height } = await renderStickerImage(sticker)
    overlays.push({ start: 0, end: look.firstShotDuration, image, y: clampedSubtitleY(STICKER_CENTER_Y, height) })
  }
  return overlays
}

/**
 * Burn bilingual subtitles into the video: render one PNG per cue with a
 * `ja` translation and composite each over its time window. Uses the
 * hardware encoder via WebCodecs when available (issue #10), otherwise
 * ffmpeg.wasm's overlay filtergraph.
 *
 * Re-encodes the whole joined video, so FinalizePage only falls back to it
 * when burning shot by shot (burnShotSubtitles) isn't possible. That can
 * take minutes on a phone, hence `onProgress` (0–1) on both backends.
 * Cues are styled here (see styleCues), so pass them as edited.
 */
export async function burnSubtitles(
  videoBlob: Blob,
  cues: SubtitleCue[],
  look: SubtitleLook,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  // The whole joined video starts with the first shot, so hook cues are
  // those starting within its length, as in the per-shot path.
  const translated = styleCues(cues, look.firstShotDuration, look.hook.style).filter(c => c.ja !== null)
  if (translated.length === 0 && !hasFirstShotExtras(look.hook, look.firstShotDuration)) {
    // Nothing to burn in — return the video unchanged.
    return videoBlob
  }
  const overlays = await renderSubtitleOverlays(translated, look)
  const plan = punchInPlan(look.hook, look.firstShotDuration)

  if (await canUseWebCodecs()) {
    try {
      return await burnSubtitlesWebCodecs(videoBlob, overlays, onProgress, signal, { punchIn: plan })
    } catch (err) {
      // A cancel isn't WebCodecs breaking down: don't fall back or turn it off.
      throwIfCancelled(signal)
      disableWebCodecs(err)
      onProgress?.(0)
    }
  }
  return burnSubtitlesFFmpeg(videoBlob, overlays, plan, onProgress, signal)
}

/**
 * Trim and normalize one shot with its subtitles composited in the same
 * hardware encode (see normalizeShotWebCodecs). `cues` are already styled
 * on the joined timeline and moved into the trimmed shot's own (see
 * shotBurnRequests). WebCodecs only — throws when it's unavailable, so the
 * caller can fall back to burnSubtitles on the joined video.
 */
export async function burnShotSubtitles(
  blob: Blob,
  start: number,
  end: number,
  cues: StyledCue[],
  look: SubtitleLook,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  if (!(await canUseWebCodecs())) throw new Error('WebCodecs unavailable for per-shot burn-in')
  const overlays = await renderSubtitleOverlays(cues, look)
  return normalizeShotWebCodecs(blob, start, end, onProgress, overlays, signal, {
    punchIn: punchInPlan(look.hook, look.firstShotDuration),
  })
}

function cueDuration(cue: SubtitleCue): number {
  return Math.max(0.1, cue.end - cue.start)
}

/**
 * The video's duration in seconds read from its container (no <video>
 * player, see issue #12), or 0 if it can't be read.
 */
async function containerDuration(blob: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const duration = await input.computeDuration()
    return Number.isFinite(duration) && duration > 0 ? duration : 0
  } catch {
    return 0
  } finally {
    input.dispose()
  }
}

/**
 * ffmpeg.wasm's own `progress` ratio is measured against its inputs'
 * durations, which the looped subtitle images make meaningless here, so
 * derive it from the output timestamp (`time`, in microseconds) instead.
 */
export function ffmpegProgressRatio(timeMicros: number, durationSec: number): number {
  if (!(durationSec > 0) || !Number.isFinite(timeMicros)) return 0
  return Math.min(Math.max(timeMicros / 1e6 / durationSec, 0), 1)
}

/**
 * ffmpeg.wasm path: feed each overlay's PNG in as a time-bounded image input
 * and composite them via a chained overlay filtergraph, over the zoom in
 * when there is one.
 */
async function burnSubtitlesFFmpeg(
  videoBlob: Blob,
  overlays: SubtitleOverlay[],
  plan: PunchInPlan | null,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  const duration = onProgress ? await containerDuration(videoBlob) : 0
  const ff = await getFFmpeg()
  // getFFmpeg() can take a while on first load; if the abort landed while it
  // was pending, bail before registering onAbort below — otherwise it would
  // fire immediately and terminate the shared instance a retry may already
  // be using (issue #34).
  throwIfCancelled(signal)
  // Terminating ffmpeg is the only way to stop an exec() midway (issue #34).
  const unregister = onAbort(signal, releaseFFmpeg)
  try {
    await ff.writeFile('in.mp4', await fetchFile(videoBlob))

    const args: string[] = ['-i', 'in.mp4']
    for (let i = 0; i < overlays.length; i++) {
      const overlay = overlays[i]
      const name = `sub${i}.png`
      await ff.writeFile(name, await fetchFile(overlay.image))
      // `-itsoffset` (not `-ss`) is what delays this input's presentation
      // timestamps so it starts compositing at overlay.start: `-ss` before `-i`
      // seeks into the SOURCE's own content, which is meaningless for a
      // `-loop 1` static image (there is nothing to seek past) and so does
      // NOT delay when the overlay appears in the composited output — every
      // image would otherwise start compositing at t=0.
      args.push('-loop', '1', '-itsoffset', overlay.start.toFixed(3), '-t', (overlay.end - overlay.start).toFixed(3), '-i', name)
    }

    const { filterGraph, outputLabel } = buildOverlayFilterGraph(
      overlays.map(o => o.y),
      plan !== null ? punchInFilter(plan) : undefined,
    )

    // buildOverlayFilterGraph's chain references each overlay's image input by an
    // arbitrary label ([sub0], [sub1], ...), but ffmpeg only recognizes an
    // input by its positional stream specifier ([1:v], [2:v], ...) unless a
    // filter stage explicitly defines that label first. Without this alias
    // preamble, ffmpeg fails immediately with "Invalid stream specifier" /
    // "matches no streams" and the whole -filter_complex is rejected. Each
    // overlay's PNG is input index i+1 (input 0 is the base video), so alias it
    // to the label the chain expects via a no-op `copy` filter.
    //
    // Each overlay stage also needs `eof_action=pass`: once an overlay's
    // (duration-bounded) image stream ends, overlay's default eof_action is
    // `repeat`, which freezes and keeps showing that image's last frame for
    // the rest of the output — so an overlay that already ended would otherwise
    // stay burned in (and, being the topmost stage, visually hide every
    // later overlay too) all the way to the end of the video. `pass` makes the
    // stage fall back to showing its unmodified input once the overlay
    // stream ends, so the caption correctly disappears at overlay.end.
    const aliasStages = overlays.map((_, i) => `[${i + 1}:v]copy[sub${i}]`)
    const overlayStages = filterGraph.replace(/overlay=/g, 'overlay=eof_action=pass:')
    const fullFilterGraph = [...aliasStages, overlayStages].filter(Boolean).join(';')

    args.push(
      '-filter_complex', fullFilterGraph,
      '-map', outputLabel,
      '-map', '0:a',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'copy',
      '-shortest',
      '-movflags', '+faststart',
      'out.mp4',
    )

    const reportProgress = ({ time }: { time: number }) => onProgress?.(ffmpegProgressRatio(time, duration))
    if (onProgress && duration > 0) ff.on('progress', reportProgress)
    try {
      await execFFmpeg(ff, args)
    } finally {
      ff.off('progress', reportProgress)
    }
    const data = await ff.readFile('out.mp4')

    ff.deleteFile('in.mp4')
    for (let i = 0; i < overlays.length; i++) ff.deleteFile(`sub${i}.png`)
    ff.deleteFile('out.mp4')

    return new Blob([data as Uint8Array], { type: 'video/mp4' })
  } catch (err) {
    throwIfCancelled(signal)
    throw err
  } finally {
    unregister()
  }
}
