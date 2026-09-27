import { FFmpeg } from '@ffmpeg/ffmpeg'

let ffmpeg: FFmpeg | null = null
let loaded: Promise<void> | null = null

/**
 * Shared FFmpeg singleton used by every ffmpeg.wasm caller in the app.
 * Originally split per-module, which was harmless on the single-threaded
 * core but became a problem when a since-reverted attempt switched to the
 * multi-threaded @ffmpeg/core-mt (each instance spins up its own pthread
 * pool, and two alive at once — e.g. combine's trimAndNormalizeShot followed
 * by concatVideos — starved Safari of threads). @ffmpeg/core-mt was reverted
 * after it turned out to be broadly unreliable on Safari/iOS (a WASM
 * `call_indirect` runtime crash, on top of the threading issue above), but
 * one shared instance remains the right shape regardless of core.
 */
export async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) ffmpeg = new FFmpeg()
  if (!loaded) {
    const origin = window.location.origin
    loaded = ffmpeg.load({
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
    }).then(() => undefined)
  }
  await loaded
  return ffmpeg
}

/**
 * Terminate the shared instance so its worker — and the WASM heap with it —
 * is freed; the next getFFmpeg() starts a fresh one. ffmpeg-core's memory
 * grows (up to 2 GB) to fit the largest file it has handled and never
 * shrinks, so after an import the tab otherwise keeps that whole heap alive.
 * On iOS that left too little memory for the finalize screen's <video>
 * previews to load until the app was restarted (issue #12).
 *
 * This aborts any ffmpeg work in flight — call it only when nothing is
 * running, or to stop that work on purpose (中断する, issue #34).
 */
export function releaseFFmpeg(): void {
  if (!ffmpeg) return
  ffmpeg.terminate()
  ffmpeg = null
  loaded = null
}
