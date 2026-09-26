import { FFmpeg } from '@ffmpeg/ffmpeg'

let ffmpeg: FFmpeg | null = null
let loaded: Promise<void> | null = null

/**
 * Shared FFmpeg singleton used by every ffmpeg.wasm caller in the app.
 * @ffmpeg/core-mt (the multi-threaded core) spins up its own pthread worker
 * pool per FFmpeg instance. Previously each util module (trimAndNormalizeShot,
 * concatVideos, burnSubtitles, mixMusic, remuxMp4) kept its own private
 * FFmpeg singleton, so a flow like the finalize wizard's combine step —
 * trimAndNormalizeShot followed by concatVideos — ended up with two
 * multi-threaded pthread pools alive at once. On mobile Safari that starved
 * the second pool of threads and either hung indefinitely or surfaced as an
 * internal error from the vendored core. Routing every caller through one
 * shared, lazily-loaded instance guarantees at most one pthread pool is ever
 * alive.
 */
export async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) ffmpeg = new FFmpeg()
  if (!loaded) {
    const origin = window.location.origin
    loaded = ffmpeg.load({
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
      workerURL: `${origin}/ffmpeg/ffmpeg-core.worker.js`,
    }).then(() => undefined)
  }
  await loaded
  return ffmpeg
}
