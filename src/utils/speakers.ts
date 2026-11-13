import { cuesByShot, type ShotCueInput, type SubtitleCue } from './subtitleCues'
import type { HookOptions } from './subtitleHook'

/** The other person, when the script names no icon for them. */
export const DEFAULT_SPEAKER_ICON = '🗣️'
/** What the other person's subtitle is filled with, where ours is white. */
export const SPEAKER_TEXT_COLOR = '#A8E0FF'
/** The icon's disc, as a share of the English font size. */
export const SPEAKER_RADIUS_RATIO = 0.6
/** The emoji inside the disc, as a share of the English font size. */
export const SPEAKER_EMOJI_RATIO = 0.78
/** Between the disc and the first letter of the line, in reference px. */
export const SPEAKER_GAP = 14

/** A 相手のセリフ subtitle: whose icon goes beside which cue. */
export interface CueSpeaker {
  cueId: string
  icon: string
}

/**
 * `hook` with the other person's icon on every cue of a 相手のセリフ shot
 * (`inputs` are the joined video's shots in order), so the burn and the
 * preview draw those lines as someone else's: tinted, with the icon beside
 * the first line. Unchanged for a script that is all one voice.
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
