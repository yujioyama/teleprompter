import { FFmpeg } from '@ffmpeg/ffmpeg'

/**
 * @ffmpeg/core-mt's own exec() wrapper swallows the exception Emscripten
 * throws to unwind the WASM stack on a normal exit() by checking
 * `!e.message.startsWith('Aborted')` (see node_modules/@ffmpeg/core-mt's
 * ffmpeg-core.js). On Safari/WebKit that unwind value doesn't carry a
 * `.message` property the way it does on Chromium, so the vendored check
 * itself throws `TypeError: undefined is not an object (evaluating
 * 'e.message.startsWith')` — on every run that completes normally, not just
 * failures.
 *
 * That exception happens inside @ffmpeg/ffmpeg's worker, which catches it and
 * posts back `e.toString()` — a plain STRING, not an Error (see
 * node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js's onmessage handler and
 * classes.js's ERROR case, which rejects with that string as-is). So `ff.exec`
 * rejects with a string, never a TypeError instance — check the string
 * directly instead of `instanceof`.
 *
 * Swallow that specific vendor bug here; a genuine command failure still
 * surfaces because the caller's subsequent `readFile` of the expected output
 * will throw when nothing was written.
 */
export async function execFFmpeg(ff: FFmpeg, args: string[]): Promise<void> {
  try {
    await ff.exec(args)
  } catch (err) {
    if (!(typeof err === 'string' && err.includes("e.message.startsWith"))) {
      throw err
    }
  }
}
