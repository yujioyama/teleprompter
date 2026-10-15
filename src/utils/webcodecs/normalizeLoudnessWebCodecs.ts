import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { applyAudioFinish, LOUDNESS_ONLY, type AudioFinish } from '../audioFinish'
import { decodeAudioTrack, muxWithAudio } from './audioTrack'

/**
 * WebCodecs counterpart of the ffmpeg export pass: the audio is decoded,
 * finished (voice preset, target loudness; see audioFinish.ts) and
 * re-encoded, with the video packets copied as-is. A video nothing changes
 * (already at the target, no audible audio) comes back as the same blob.
 */
export async function finishAudioWebCodecs(videoBlob: Blob, finish: AudioFinish): Promise<Blob> {
  const input = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS })
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!videoTrack) throw new Error('video has no video track')
    if (!audioTrack) return videoBlob

    const audio = await decodeAudioTrack(audioTrack)
    if (!applyAudioFinish(channelsOf(audio), audio.sampleRate, finish)) return videoBlob
    return await muxWithAudio(videoTrack, audio)
  } finally {
    input.dispose()
  }
}

/** Just the loudness correction, as each take gets on import (processRecordedVideo). */
export function normalizeLoudnessWebCodecs(videoBlob: Blob): Promise<Blob> {
  return finishAudioWebCodecs(videoBlob, LOUDNESS_ONLY)
}

/**
 * Bring `audio` to the target loudness in place. Returns false, leaving it
 * untouched, when it already is there (or has no audible audio).
 */
export function applyTargetLoudness(audio: AudioBuffer): boolean {
  return applyAudioFinish(channelsOf(audio), audio.sampleRate, LOUDNESS_ONLY)
}

/**
 * `audio`'s channels as live views (getChannelData), so processing them
 * lands in `audio` itself.
 */
export function channelsOf(audio: AudioBuffer): Float32Array[] {
  return Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
}
