import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { SubtitleCue } from './subtitleCues'
import { SubtitlePosition, subtitleY } from './subtitlePosition'

let ffmpeg: FFmpeg | null = null
let loaded = false

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) ffmpeg = new FFmpeg()
  if (!loaded) {
    const origin = window.location.origin
    await ffmpeg.load({
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
    })
    loaded = true
  }
  return ffmpeg
}

/**
 * Build the chained overlay filtergraph for `cueCount` subtitle image inputs
 * (indices 1..cueCount, input 0 is the base video), each composited at the
 * same fixed (horizontally centered, given Y) position. Each image input is
 * itself time-bounded via `-loop 1 -t <duration>` and a `-ss <start>` offset
 * at the ffmpeg-input level (see burnSubtitles below), so no `enable=`
 * time-window expression is needed here — simpler and less error-prone than
 * threading per-cue timing through the filter string itself.
 */
export function buildOverlayFilterGraph(
  cueCount: number,
  y: number,
): { filterGraph: string; outputLabel: string } {
  if (cueCount === 0) {
    return { filterGraph: '', outputLabel: '[0:v]' }
  }

  const stages: string[] = []
  for (let i = 0; i < cueCount; i++) {
    const baseInput = i === 0 ? '[0:v]' : `[v${i - 1}]`
    const outputLabel = `[v${i}]`
    stages.push(`${baseInput}[sub${i}]overlay=x=(W-w)/2:y=${y}${outputLabel}`)
  }

  return { filterGraph: stages.join(';'), outputLabel: `[v${cueCount - 1}]` }
}

/**
 * Find the largest font size (in 2px steps, down to `minPx`) at which `text`
 * measures within `maxWidth` when rendered with the given `weight`. Used
 * instead of passing a `maxWidth` to `fillText`, which condenses/squashes
 * glyphs horizontally rather than shrinking or wrapping them.
 */
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startPx: number,
  minPx: number,
  weight: string,
): number {
  let size = startPx
  while (size > minPx) {
    ctx.font = `${weight} ${size}px sans-serif`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 2
  }
  return size
}

/**
 * Render one cue's bilingual subtitle (English bold/larger above, Japanese
 * smaller below, on a semi-transparent rounded background) as a transparent
 * PNG sized to the video width.
 */
export async function renderCueImage(cue: SubtitleCue, videoWidth: number): Promise<Blob> {
  const height = 220
  const canvas = document.createElement('canvas')
  canvas.width = videoWidth
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  ctx.clearRect(0, 0, videoWidth, height)

  const padding = 24
  const boxTop = 20
  const boxHeight = height - 40
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  const radius = 16
  ctx.beginPath()
  ctx.roundRect(padding, boxTop, videoWidth - padding * 2, boxHeight, radius)
  ctx.fill()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'

  const textWidth = videoWidth - padding * 4
  const enFontSize = fitFontSize(ctx, cue.en, textWidth, 52, 24, 'bold')
  ctx.font = `bold ${enFontSize}px sans-serif`
  ctx.fillText(cue.en, videoWidth / 2, boxTop + 70)

  const jaText = cue.ja ?? ''
  const jaFontSize = fitFontSize(ctx, jaText, textWidth, 34, 18, '')
  ctx.font = `${jaFontSize}px sans-serif`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.fillText(jaText, videoWidth / 2, boxTop + 130)

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to render subtitle image'))
    }, 'image/png')
  })
}

const VIDEO_WIDTH = 1080
const VIDEO_HEIGHT = 1920
const OVERLAY_HEIGHT = 220

/**
 * Burn bilingual subtitles into the video: render one PNG per cue with a
 * `ja` translation, feed each in as a time-bounded image input, and
 * composite them via a chained overlay filtergraph.
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

  const ff = await getFFmpeg()
  await ff.writeFile('in.mp4', await fetchFile(videoBlob))

  const args: string[] = ['-i', 'in.mp4']
  for (let i = 0; i < translated.length; i++) {
    const cue = translated[i]
    const imageBlob = await renderCueImage(cue, VIDEO_WIDTH)
    const name = `sub${i}.png`
    await ff.writeFile(name, await fetchFile(imageBlob))
    const duration = Math.max(0.1, cue.end - cue.start)
    // `-itsoffset` (not `-ss`) is what delays this input's presentation
    // timestamps so it starts compositing at cue.start: `-ss` before `-i`
    // seeks into the SOURCE's own content, which is meaningless for a
    // `-loop 1` static image (there is nothing to seek past) and so does
    // NOT delay when the overlay appears in the composited output — every
    // image would otherwise start compositing at t=0.
    args.push('-loop', '1', '-itsoffset', cue.start.toFixed(3), '-t', duration.toFixed(3), '-i', name)
  }

  const y = subtitleY(position, VIDEO_HEIGHT, OVERLAY_HEIGHT)
  const { filterGraph, outputLabel } = buildOverlayFilterGraph(translated.length, y)

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

  await ff.exec(args)
  const data = await ff.readFile('out.mp4')

  ff.deleteFile('in.mp4')
  for (let i = 0; i < translated.length; i++) ff.deleteFile(`sub${i}.png`)
  ff.deleteFile('out.mp4')

  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}
