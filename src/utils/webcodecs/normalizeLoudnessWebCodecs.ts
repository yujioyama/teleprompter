import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { applyGainWithLimiter, planLoudnessGain } from '../loudness'
import { decodeAudioTrack, muxWithAudio } from './audioTrack'

/**
 * WebCodecs counterpart of the ffmpeg loudness pass: the audio is decoded,
 * brought to the target loudness (see loudness.ts) and re-encoded, with the
 * video packets copied as-is. A video already at the target (or with no
 * audible audio) comes back unchanged, as the same blob.
 */
export async function normalizeLoudnessWebCodecs(videoBlob: Blob): Promise<Blob> {
  const input = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS })
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!videoTrack) throw new Error('video has no video track')
    if (!audioTrack) return videoBlob

    const audio = await decodeAudioTrack(audioTrack)
    if (!applyTargetLoudness(audio)) return videoBlob
    return await muxWithAudio(videoTrack, audio)
  } finally {
    input.dispose()
  }
}

/**
 * Bring `audio` to the target loudness in place. Returns false, leaving it
 * untouched, when it already is there (or has no audible audio).
 */
export function applyTargetLoudness(audio: AudioBuffer): boolean {
  // getChannelData returns live views, so the gain lands in `audio` itself.
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
  const gainDb = planLoudnessGain(channels, audio.sampleRate)
  if (gainDb === null) return false
  applyGainWithLimiter(channels, audio.sampleRate, gainDb)
  return true
}
