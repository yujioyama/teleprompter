import { remuxMp4 } from './remuxMp4'
import { detectSpeechBounds } from './detectSpeechBounds'

export interface ShotTrimSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
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
// Also detects and trims leading/trailing silence in the same FFmpeg pass.
export async function processRecordedVideo(
  raw: Blob,
  mimeType: string,
  shotSettings: ShotTrimSettings,
): Promise<ProcessedVideo> {
  if (!isRemuxableContainer(mimeType)) {
    // webm: trimming not supported, silently ignored
    return { blob: raw, ok: true, error: null }
  }

  let trim = null
  if (shotSettings.trimEnabled) {
    trim = await detectSpeechBounds(raw, shotSettings.trimPaddingStart, shotSettings.trimPaddingEnd)
  }
  const result = await remuxMp4(raw, {
    trim: trim ?? undefined,
    normalize: shotSettings.normalizeAudio,
  })
  return { blob: result.blob, ok: result.ok, error: result.error ?? null }
}
