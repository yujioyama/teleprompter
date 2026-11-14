import { cuesByShot, type ShotCueInput, type SubtitleCue } from './subtitleCues'
import type { HookOptions } from './subtitleHook'

/** The other person, when the script names no icon for them. */
export const DEFAULT_SPEAKER_ICON = '🗣️'
/** What the other person's subtitle is filled with, where ours is white. */
export const SPEAKER_TEXT_COLOR = '#A8E0FF'

/** A 相手のセリフ subtitle: whose icon goes beside which cue. */
export interface CueSpeaker {
  cueId: string
  icon: string
}

/**
 * `hook` with the other person's icon on every cue of a 相手のセリフ shot
 * (`inputs` are the joined video's shots in order), so the burn and the
 * preview draw those lines as someone else's: tinted, in a speech bubble
 * with the icon above it (see layoutCue). Unchanged for a script that is all one voice.
 */
export function withSpeakers(hook: HookOptions, cues: SubtitleCue[], inputs: ShotCueInput[]): HookOptions {
  if (!inputs.some(input => input.speaker)) return hook
  const speakers: CueSpeaker[] = cuesByShot(cues, inputs.map(input => input.duration)).flatMap((group, i) => {
    const icon = inputs[i].speaker
    return icon ? group.map(cue => ({ cueId: cue.id, icon })) : []
  })
  return speakers.length > 0 ? { ...hook, speakers } : hook
}

/** The icon beside `cueId`'s subtitle, or undefined for our own line. */
export function speakerOf(hook: Pick<HookOptions, 'speakers'> | undefined, cueId: string): string | undefined {
  return hook?.speakers?.find(speaker => speaker.cueId === cueId)?.icon
}
