import { remuxMp4 } from './remuxMp4'
import { canUseWebCodecs } from './webcodecs/support'
import { normalizeLoudnessWebCodecs } from './webcodecs/normalizeLoudnessWebCodecs'

export interface ProcessOptions {
  normalizeAudio: boolean
}

export interface ProcessedVideo {
  blob: Blob
  ok: boolean
  error: string | null
}

// mov and mp4 are both the ISO base media container (ffmpeg's mov,mp4,m4a,3gp,3g2,mj2
// demuxer handles either identically), so a .mov clip imported from the camera roll
// (e.g. from the native Cinematic-capture companion app) is just as remuxable as mp4.
export function isRemuxableContainer(mimeType: string): boolean {
  return mimeType.includes('mp4') || mimeType.includes('quicktime')
}

export function inferMimeType(file: File): string {
  if (file.type) return file.type
  if (/\.mov$/i.test(file.name)) return 'video/quicktime'
  if (/\.mp4$/i.test(file.name)) return 'video/mp4'
  return 'video/webm'
}

// Audio normalization brings each take to -14 LUFS so the BGM mix, whose
// gain is absolute, sits the same way under every shot. It goes through
// WebCodecs when it can: ffmpeg.wasm's loudnorm re-encode was ~95% of an
// import's time and ~10x slower than this (issue #30).
//
// Everything else keeps the take exactly as it came in. There used to be an
// ffmpeg.wasm faststart remux on every import, a leftover from MediaRecorder's
// fragmented MP4s: it loaded the ~30MB ffmpeg core and copied the whole take
// through it just to move the moov atom, which nothing downstream needs — the
// takes are only ever read from a local Blob, where the moov can sit anywhere.
// The whole take is kept: the silence around the speech is only cut in the
// finalize step, where the auto-detected cut can still be adjusted (issue #21).
export async function processRecordedVideo(
  raw: Blob,
  mimeType: string,
  options: ProcessOptions,
): Promise<ProcessedVideo> {
  if (!isRemuxableContainer(mimeType) || !options.normalizeAudio) {
    return { blob: raw, ok: true, error: null }
  }

  if (await canUseWebCodecs()) {
    try {
      // Comes back as the same blob when the audio is already on target.
      return { blob: await normalizeLoudnessWebCodecs(raw), ok: true, error: null }
    } catch (err) {
      console.warn('[processRecordedVideo] WebCodecs normalize failed, falling back to ffmpeg:', err)
    }
  }

  const result = await remuxMp4(raw, { normalize: true })
  return { blob: result.blob, ok: result.ok, error: result.error ?? null }
}
