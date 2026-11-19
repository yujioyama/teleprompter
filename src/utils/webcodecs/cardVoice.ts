import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { detectSpeech } from '../detectSpeechBounds'
import { lineOf, VOICE_PADDING_S } from '../heardShot'
import { levelVoice, narratorVoice } from '../voiceEffects'
import { decodeAudioTrack } from './audioTrack'
import { spokenPart } from './heardShot'

/**
 * 挿入カードの声: the narrator's recording for a card as it plays on the card —
 * cut to the words (with the breath a line keeps around it), the room's hiss
 * taken out, in the narrator's voice (see narratorVoice) and as loud as our
 * own lines. Null when there are no words in it.
 */
export async function prepareCardVoice(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const region = await detectSpeech(blob)
  if (!region) return null
  const line = lineOf(region)
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const start = Math.max(0, line.start - VOICE_PADDING_S)
    const end = Math.min(region.duration, line.end + VOICE_PADDING_S)
    const spoken = spokenPart(await decodeAudioTrack(track), start, end)
    return { samples: levelVoice(narratorVoice(spoken.samples, spoken.sampleRate), spoken.sampleRate), sampleRate: spoken.sampleRate }
  } finally {
    input.dispose()
  }
}
