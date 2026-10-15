import { applyGainWithLimiter, planLoudnessGain } from './loudness'
import { applyVoicePreset, type VoicePreset } from './voicePreset'

/** What the export does to the finished video's audio. */
export interface AudioFinish {
  /** Applied to the voice; 'none' when it already was (BGM mixed in). */
  voice: VoicePreset
  /** Bring it to the loudness the platforms play back at (loudness.ts). */
  normalize: boolean
}

export const LOUDNESS_ONLY: AudioFinish = { voice: 'none', normalize: true }

export function isNoFinish(finish: AudioFinish): boolean {
  return finish.voice === 'none' && !finish.normalize
}

export function finishKey(finish: AudioFinish): string {
  return `${finish.voice}:${finish.normalize}`
}

/**
 * Apply `finish` to the audio in place: the voice preset, then the loudness
 * correction. Returns false, leaving it untouched, when neither changed it.
 */
export function applyAudioFinish(channels: Float32Array[], sampleRate: number, finish: AudioFinish): boolean {
  const voiced = applyVoicePreset(channels, sampleRate, finish.voice)
  if (!finish.normalize) return voiced
  const gainDb = planLoudnessGain(channels, sampleRate)
  if (gainDb === null) return voiced
  applyGainWithLimiter(channels, sampleRate, gainDb)
  return true
}
