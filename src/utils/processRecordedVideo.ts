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

// Remux to move the moov atom to the front (faststart) for editor compatibility.
// The whole take is kept: the silence around the speech is only cut in the
// finalize step, where the auto-detected cut can still be adjusted (issue #21).
//
// Audio normalization brings each take to -14 LUFS so the BGM mix, whose
// gain is absolute, sits the same way under every shot. It goes through
// WebCodecs when it can: ffmpeg.wasm's loudnorm re-encode was ~95% of an
// import's time and ~10x slower than this (issue #30). The WebCodecs pass
// writes a faststart MP4 itself, so ffmpeg.wasm isn't even loaded then.
export async function processRecordedVideo(
  raw: Blob,
  mimeType: string,
  options: ProcessOptions,
): Promise<ProcessedVideo> {
  if (!isRemuxableContainer(mimeType)) {
    return { blob: raw, ok: true, error: null }
  }

  let normalize = options.normalizeAudio
  if (normalize && (await canUseWebCodecs())) {
    try {
      const normalized = await normalizeLoudnessWebCodecs(raw)
      if (normalized !== raw) return { blob: normalized, ok: true, error: null }
      // Already on target, so all that's left is the remux.
      normalize = false
    } catch (err) {
      console.warn('[processRecordedVideo] WebCodecs normalize failed, falling back to ffmpeg:', err)
    }
  }

  const result = await remuxMp4(raw, { normalize })
  return { blob: result.blob, ok: result.ok, error: result.error ?? null }
}
