import { applyGainWithLimiter, planLoudnessGain } from './loudness'
import { applyVoicePreset, type VoicePreset } from './voicePreset'
import { reduceOwnVoiceNoise, type NoiseReduction } from './ownVoiceNoise'

/** What the export does to the finished video's audio. */
export interface AudioFinish {
  /** Applied to the voice; 'none' when it already was (BGM mixed in). */
  voice: VoicePreset
  /** Bring it to the loudness the platforms play back at (loudness.ts). */
  normalize: boolean
  /** ノイズ除去 first (our own takes, on import); absent = off. */
  denoise?: NoiseReduction
}

export const LOUDNESS_ONLY: AudioFinish = { voice: 'none', normalize: true }

export function isNoFinish(finish: AudioFinish): boolean {
  return finish.voice === 'none' && !finish.normalize && (finish.denoise ?? 'off') === 'off'
}

export function finishKey(finish: AudioFinish): string {
  const denoise = finish.denoise ?? 'off'
  return denoise === 'off' ? `${finish.voice}:${finish.normalize}` : `${finish.voice}:${finish.normalize}:${denoise}`
}

/**
 * Apply `finish` to the audio in place: the noise reduction, the voice
 * preset, then the loudness correction. Returns false, leaving it
 * untouched, when none changed it.
 */
export function applyAudioFinish(channels: Float32Array[], sampleRate: number, finish: AudioFinish): boolean {
  const cleaned = reduceOwnVoiceNoise(channels, finish.denoise ?? 'off')
  const voiced = applyVoicePreset(channels, sampleRate, finish.voice) || cleaned
  if (!finish.normalize) return voiced
  const gainDb = planLoudnessGain(channels, sampleRate)
  if (gainDb === null) return voiced
  applyGainWithLimiter(channels, sampleRate, gainDb)
  return true
}
