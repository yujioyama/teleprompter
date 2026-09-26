import { FFmpeg } from '@ffmpeg/ffmpeg'

/**
 * @ffmpeg/core-mt's own exec() wrapper swallows the exception Emscripten
 * throws to unwind the WASM stack on a normal exit() by checking
 * `!e.message.startsWith('Aborted')` (see node_modules/@ffmpeg/core-mt's
 * ffmpeg-core.js). On Safari/WebKit that unwind value doesn't carry a
 * `.message` property the way it does on Chromium, so the vendored check
 * itself throws `TypeError: undefined is not an object (evaluating
 * 'e.message.startsWith')` — on every run that completes normally, not just
 * failures. Swallow that specific vendor bug here; a genuine command failure
 * still surfaces because the caller's subsequent `readFile` of the expected
 * output will throw when nothing was written.
 */
export async function execFFmpeg(ff: FFmpeg, args: string[]): Promise<void> {
  try {
    await ff.exec(args)
  } catch (err) {
    if (!(err instanceof TypeError && err.message.includes("e.message.startsWith"))) {
      throw err
    }
  }
}
