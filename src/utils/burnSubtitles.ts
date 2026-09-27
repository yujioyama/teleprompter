import { fetchFile } from '@ffmpeg/util'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg } from './ffmpegClient'
import { SubtitleCue } from './subtitleCues'
import { SubtitlePosition, subtitleY } from './subtitlePosition'
import { canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { burnSubtitlesWebCodecs } from './webcodecs/burnSubtitlesWebCodecs'
import {
  EN_STYLE,
  JA_STYLE,
  SUBTITLE_BLOCK_GAP,
  SUBTITLE_BOX_MARGIN_X,
  SUBTITLE_BOX_PADDING_Y,
  SUBTITLE_BOX_RADIUS,
  SUBTITLE_REFERENCE_WIDTH,
  TextBlockLayout,
  fontFor,
  layoutCue,
} from './subtitleLayout'

/**
 * Build the chained overlay filtergraph for one subtitle image input per
 * entry of `ys` (indices 1..ys.length, input 0 is the base video), each
 * composited horizontally centered at its own Y (cue boxes differ in height
 * with their line count). Each image input is itself time-bounded via
 * `-loop 1 -t <duration>` and an `-itsoffset <start>` at the ffmpeg-input
 * level (see burnSubtitles below), so no `enable=` time-window expression is
 * needed here — simpler and less error-prone than threading per-cue timing
 * through the filter string itself.
 */
export function buildOverlayFilterGraph(ys: number[]): { filterGraph: string; outputLabel: string } {
  if (ys.length === 0) {
    return { filterGraph: '', outputLabel: '[0:v]' }
  }

  const stages = ys.map((y, i) => {
    const baseInput = i === 0 ? '[0:v]' : `[v${i - 1}]`
    return `${baseInput}[sub${i}]overlay=x=(W-w)/2:y=${y}[v${i}]`
  })

  return { filterGraph: stages.join(';'), outputLabel: `[v${ys.length - 1}]` }
}

/**
 * Render one cue's bilingual subtitle (English bold/larger above, Japanese
 * smaller below, on a semi-transparent rounded background) as a transparent
 * PNG as wide as the video and exactly as tall as its box. Text is wrapped
 * onto balanced lines (see subtitleLayout) rather than shrunk until it fits
 * one line, which left long cues unreadably small and still overflowing.
 */
export async function renderCueImage(cue: SubtitleCue): Promise<{ image: Blob; height: number }> {
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (!measureCtx) throw new Error('Canvas 2D context unavailable')
  const layout = layoutCue(cue, (text, font) => {
    measureCtx.font = font
    return measureCtx.measureText(text).width
  })

  const width = SUBTITLE_REFERENCE_WIDTH
  const height = layout.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.beginPath()
  ctx.roundRect(SUBTITLE_BOX_MARGIN_X, 0, width - SUBTITLE_BOX_MARGIN_X * 2, height, SUBTITLE_BOX_RADIUS)
  ctx.fill()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let top = SUBTITLE_BOX_PADDING_Y
  const drawBlock = (block: TextBlockLayout, font: string, color: string) => {
    ctx.font = font
    ctx.fillStyle = color
    for (const line of block.lines) {
      ctx.fillText(line, width / 2, top + block.lineHeightPx / 2)
      top += block.lineHeightPx
    }
  }
  drawBlock(layout.en, fontFor(EN_STYLE, layout.en.fontPx), '#ffffff')
  if (layout.ja) {
    top += SUBTITLE_BLOCK_GAP
    drawBlock(layout.ja, fontFor(JA_STYLE, layout.ja.fontPx), 'rgba(255, 255, 255, 0.85)')
  }

  const image = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to render subtitle image'))
    }, 'image/png')
  })
  return { image, height }
}

const VIDEO_HEIGHT = 1920

/**
 * Burn bilingual subtitles into the video: render one PNG per cue with a
 * `ja` translation and composite each over its time window. Uses the
 * hardware encoder via WebCodecs when available (issue #10), otherwise
 * ffmpeg.wasm's overlay filtergraph.
 */
export async function burnSubtitles(
  videoBlob: Blob,
  cues: SubtitleCue[],
  position: SubtitlePosition,
): Promise<Blob> {
  const translated = cues.filter(c => c.ja !== null)
  if (translated.length === 0) {
    // Nothing to burn in — return the video unchanged.
    return videoBlob
  }

  const images: Blob[] = []
  const ys: number[] = []
  for (const cue of translated) {
    const { image, height } = await renderCueImage(cue)
    images.push(image)
    // Centered on the chosen position, but kept fully on screen.
    ys.push(Math.min(Math.max(subtitleY(position, VIDEO_HEIGHT, height), 0), VIDEO_HEIGHT - height))
  }

  if (await canUseWebCodecs()) {
    try {
      return await burnSubtitlesWebCodecs(
        videoBlob,
        translated.map((cue, i) => ({
          start: cue.start,
          end: cue.start + cueDuration(cue),
          image: images[i],
          y: ys[i],
        })),
      )
    } catch (err) {
      disableWebCodecs(err)
    }
  }
  return burnSubtitlesFFmpeg(videoBlob, translated, images, ys)
}

function cueDuration(cue: SubtitleCue): number {
  return Math.max(0.1, cue.end - cue.start)
}

/**
 * ffmpeg.wasm path: feed each cue's PNG in as a time-bounded image input and
 * composite them via a chained overlay filtergraph.
 */
async function burnSubtitlesFFmpeg(
  videoBlob: Blob,
  translated: SubtitleCue[],
  images: Blob[],
  ys: number[],
): Promise<Blob> {
  const ff = await getFFmpeg()
  await ff.writeFile('in.mp4', await fetchFile(videoBlob))

  const args: string[] = ['-i', 'in.mp4']
  for (let i = 0; i < translated.length; i++) {
    const cue = translated[i]
    const name = `sub${i}.png`
    await ff.writeFile(name, await fetchFile(images[i]))
    const duration = cueDuration(cue)
    // `-itsoffset` (not `-ss`) is what delays this input's presentation
    // timestamps so it starts compositing at cue.start: `-ss` before `-i`
    // seeks into the SOURCE's own content, which is meaningless for a
    // `-loop 1` static image (there is nothing to seek past) and so does
    // NOT delay when the overlay appears in the composited output — every
    // image would otherwise start compositing at t=0.
    args.push('-loop', '1', '-itsoffset', cue.start.toFixed(3), '-t', duration.toFixed(3), '-i', name)
  }

  const { filterGraph, outputLabel } = buildOverlayFilterGraph(ys)

  // buildOverlayFilterGraph's chain references each cue's image input by an
  // arbitrary label ([sub0], [sub1], ...), but ffmpeg only recognizes an
  // input by its positional stream specifier ([1:v], [2:v], ...) unless a
  // filter stage explicitly defines that label first. Without this alias
  // preamble, ffmpeg fails immediately with "Invalid stream specifier" /
  // "matches no streams" and the whole -filter_complex is rejected. Each
  // cue's PNG is input index i+1 (input 0 is the base video), so alias it
  // to the label the chain expects via a no-op `copy` filter.
  //
  // Each overlay stage also needs `eof_action=pass`: once a cue's
  // (duration-bounded) image stream ends, overlay's default eof_action is
  // `repeat`, which freezes and keeps showing that image's last frame for
  // the rest of the output — so a cue that already ended would otherwise
  // stay burned in (and, being the topmost stage, visually hide every
  // later cue too) all the way to the end of the video. `pass` makes the
  // stage fall back to showing its unmodified input once the overlay
  // stream ends, so the caption correctly disappears at cue.end.
  const aliasStages = translated.map((_, i) => `[${i + 1}:v]copy[sub${i}]`).join(';')
  const overlayStages = filterGraph.replace(/overlay=/g, 'overlay=eof_action=pass:')
  const fullFilterGraph = `${aliasStages};${overlayStages}`

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

  await execFFmpeg(ff, args)
  const data = await ff.readFile('out.mp4')

  ff.deleteFile('in.mp4')
  for (let i = 0; i < translated.length; i++) ff.deleteFile(`sub${i}.png`)
  ff.deleteFile('out.mp4')

  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}
