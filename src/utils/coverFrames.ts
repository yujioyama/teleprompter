import { fetchFile } from '@ffmpeg/util'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg } from './ffmpegClient'
import { canvasToPng, coverFitRect } from './coverImage'
import { OUTPUT_FRAME_RATE, OUTPUT_HEIGHT, OUTPUT_SAMPLE_RATE, OUTPUT_WIDTH, canUseWebCodecs } from './webcodecs/support'
import { insertCoverFramesWebCodecs } from './webcodecs/coverFramesWebCodecs'

/**
 * Where the export puts the cover image in the video as frames of its own
 * (カバー画像のコマ): nowhere, before the first frame — the post's default
 * thumbnail on TikTok, Instagram and in Buffer — or after the last, where
 * Buffer's thumbnail slider ends.
 */
export type CoverFramePlacement = 'none' | 'first' | 'last'

export const MIN_COVER_FRAMES = 1
export const MAX_COVER_FRAMES = 5

/** A frame count the export can use: a whole number from 1 to 5. */
export function clampCoverFrameCount(count: number): number {
  if (!Number.isFinite(count)) return MIN_COVER_FRAMES
  return Math.min(MAX_COVER_FRAMES, Math.max(MIN_COVER_FRAMES, Math.round(count)))
}

/**
 * Draw `image` at the video's size, filling it without distortion (what
 * overflows is cropped), over black where a transparent PNG leaves it bare.
 */
export async function renderCoverFrame(image: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_WIDTH
    canvas.height = OUTPUT_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    const { x, y, width, height } = coverFitRect(bitmap.width, bitmap.height, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    ctx.drawImage(bitmap, x, y, width, height)
    return canvas
  } finally {
    bitmap.close()
  }
}

/**
 * The finished video with `count` frames of the cover image at its start or
 * its end, silent under them. At the start, the voice, the BGM and the
 * subtitles all follow the cover by its length, so they stay in sync. `none`
 * returns `video` itself.
 *
 * Joins a cover clip by packet copy when WebCodecs can (see
 * insertCoverFramesWebCodecs), otherwise re-encodes the whole video with
 * ffmpeg.wasm.
 */
export async function insertCoverFrames(
  video: Blob,
  image: Blob,
  placement: CoverFramePlacement,
  count: number,
): Promise<Blob> {
  if (placement === 'none') return video
  const frames = clampCoverFrameCount(count)
  const frame = await renderCoverFrame(image)
  try {
    if (await canUseWebCodecs()) {
      try {
        return await insertCoverFramesWebCodecs(video, frame, placement, frames)
      } catch (err) {
        // Not WebCodecs breaking down, so it isn't turned off: most likely
        // a video the ffmpeg fallback made, which the cover clip can't join.
        console.warn('[insertCoverFrames] packet-copy join failed, falling back to ffmpeg:', err)
      }
    }
    return await insertCoverFramesFFmpeg(video, await canvasToPng(frame), placement, frames)
  } finally {
    frame.width = 0
    frame.height = 0
  }
}

const FILES = { video: 'cover-frames-in.mp4', cover: 'cover-frames.png', out: 'cover-frames-out.mp4' }

/**
 * ffmpeg args joining `count` frames of the cover PNG (already the video's
 * size) before or after the video, over as much silence, re-encoding both
 * to the normalize step's profile. The image is read for only a little
 * longer than the frames need, so ffmpeg doesn't queue up frames of it
 * while the video plays first. The video's audio is cut where its picture
 * ends (`videoDuration`): concat starts the next part only once both have
 * ended, and AAC's tail padding would otherwise add a frame before the cover.
 */
export function buildCoverFramesArgs(placement: 'first' | 'last', count: number, videoDuration: number): string[] {
  const duration = count / OUTPUT_FRAME_RATE
  const cover = `[1:v]trim=end_frame=${count},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[cv]`
  const silence = `anullsrc=r=${OUTPUT_SAMPLE_RATE}:cl=stereo,atrim=end=${duration.toFixed(6)}[ca]`
  const main = `[0:v]format=yuv420p,setsar=1[mv];[0:a]atrim=end=${videoDuration.toFixed(6)}[ma]`
  const segments = placement === 'first' ? '[cv][ca][mv][ma]' : '[mv][ma][cv][ca]'
  return [
    '-i', FILES.video,
    '-loop', '1',
    '-framerate', String(OUTPUT_FRAME_RATE),
    '-t', ((count + 1) / OUTPUT_FRAME_RATE).toFixed(6),
    '-i', FILES.cover,
    '-filter_complex', [cover, silence, main, `${segments}concat=n=2:v=1:a=1[v][a]`].join(';'),
    '-map', '[v]',
    '-map', '[a]',
    '-r', String(OUTPUT_FRAME_RATE),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    FILES.out,
  ]
}

async function insertCoverFramesFFmpeg(
  video: Blob,
  cover: Blob,
  placement: 'first' | 'last',
  count: number,
): Promise<Blob> {
  const ff = await getFFmpeg()
  try {
    await ff.writeFile(FILES.video, await fetchFile(video))
    await ff.writeFile(FILES.cover, await fetchFile(cover))
    await execFFmpeg(ff, buildCoverFramesArgs(placement, count, await videoDurationOf(video)))
    const data = await ff.readFile(FILES.out)
    return new Blob([data as Uint8Array], { type: 'video/mp4' })
  } finally {
    for (const name of Object.values(FILES)) {
      // Not every file exists when a step failed.
      await ff.deleteFile(name).catch(() => undefined)
    }
  }
}

/** How long the video's picture runs, read from its container. */
async function videoDurationOf(video: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('the video has no video track')
    return await track.computeDuration()
  } finally {
    input.dispose()
  }
}
