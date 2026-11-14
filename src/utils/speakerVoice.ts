import type { Shot } from '../types'
import type { HeardVoice } from './voiceEffects'

/**
 * `shots` with `voice` given to the 相手のセリフ shot `shotId` and to every
 * other 相手のセリフ shot of the same person (the same speaker icon; shots
 * without an icon count as one person), so a person's voice is chosen once
 * rather than line by line. Our own lines are left as they are.
 */
export function withSpeakerVoice(shots: Shot[], shotId: string, voice: HeardVoice): Shot[] {
  const target = shots.find(s => s.id === shotId)
  if (!target) return shots
  const value = voice === 'natural' ? undefined : voice
  const samePerson = (s: Shot) => s.id === shotId || (target.heard && s.heard && s.speaker === target.speaker)
  return shots.map(s => (samePerson(s) ? { ...s, voice: value } : s))
}
