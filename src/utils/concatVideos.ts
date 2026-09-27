import { fetchFile } from '@ffmpeg/util'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { concatClipsWebCodecs } from './webcodecs/concatClips'
import { onAbort, throwIfCancelled } from './cancellation'

/** Build the concat-demuxer list file content FFmpeg's `-f concat` expects. */
export function buildConcatListFile(filenames: string[]): string {
  return filenames.map(name => `file '${name}'\n`).join('')
}

/**
 * Concatenate already-normalized (same codec/resolution) clips by packet
 * copy. Callers are expected to have run each clip through
 * trimAndNormalizeShot first so the streams match.
 *
 * Tries a pure-JS packet copy (Mediabunny) first, which needs no
 * ffmpeg.wasm load and no copy of every clip into its memory; falls back to
 * ffmpeg's concat demuxer if that can't handle the clips.
 */
export async function concatVideos(blobs: Blob[], signal?: AbortSignal): Promise<Blob> {
  try {
    return await concatClipsWebCodecs(blobs, signal)
  } catch (err) {
    throwIfCancelled(signal)
    console.warn('[concatVideos] packet-copy concat failed, falling back to ffmpeg:', err)
  }
  return concatVideosFFmpeg(blobs, signal)
}

async function concatVideosFFmpeg(blobs: Blob[], signal?: AbortSignal): Promise<Blob> {
  throwIfCancelled(signal)
  const ff = await getFFmpeg()
  // See trimAndNormalizeShot.ts for why this is needed: a failed exec()
  // surfaces no detail beyond a generic FS/Aborted error, so the log tail is
  // the only way to see ffmpeg's actual reason for failing.
  const logs: string[] = []
  const handleLog = ({ message }: { message: string }) => {
    logs.push(message)
    if (logs.length > 40) logs.shift()
  }
  ff.on('log', handleLog)
  // Terminating ffmpeg is the only way to stop an exec() midway (issue #34).
  const unregister = onAbort(signal, releaseFFmpeg)
  try {
    const filenames = await Promise.all(
      blobs.map(async (blob, i) => {
        const name = `clip${i}.mp4`
        await ff.writeFile(name, await fetchFile(blob))
        return name
      }),
    )

    await ff.writeFile('list.txt', buildConcatListFile(filenames))
    await execFFmpeg(ff, ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4'])
    const data = await ff.readFile('out.mp4')

    await Promise.all(filenames.map(name => ff.deleteFile(name)))
    ff.deleteFile('list.txt')
    ff.deleteFile('out.mp4')

    return new Blob([data as Uint8Array], { type: 'video/mp4' })
  } catch (err) {
    throwIfCancelled(signal)
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`concatVideos failed: ${msg}\n--- ffmpeg log tail ---\n${logs.slice(-15).join('\n')}`)
  } finally {
    unregister()
    ff.off('log', handleLog)
  }
}
