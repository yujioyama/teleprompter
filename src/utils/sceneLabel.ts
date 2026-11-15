import type { SubtitleCue } from './subtitleCues'
import type { HookOptions } from './subtitleHook'
import { SUBTITLE_FONT_FAMILY, SUBTITLE_PADDING_Y, SUBTITLE_TEXT_WIDTH, type MeasureText } from './subtitleLayout'
import { SUBTITLE_VIDEO_HEIGHT } from './subtitlePosition'

/**
 * 状況のラベル: a few words on where a conversation happens ("a wrong
 * number", "online meeting"), shown over line 1 only, as a small white tag
 * on a dark pill right under line 1's subtitle. Under it rather than above:
 * line 1's subtitle already fills the band between the SNS header (top
 * ~15%) and the head, so above it the tag would be hidden under the header.
 */
export const SCENE_MAX_LENGTH = 40
export const SCENE_FONT_PX = 34
export const SCENE_FONT = `700 ${SCENE_FONT_PX}px ${SUBTITLE_FONT_FAMILY}`
export const SCENE_PAD_X = 22
export const SCENE_PAD_Y = 10
export const SCENE_PILL_HEIGHT = Math.round(SCENE_FONT_PX * 1.2) + SCENE_PAD_Y * 2
export const SCENE_FILL = 'rgba(0, 0, 0, 0.55)'
/** Room around the pill for its shadow, in the label image. */
export const SCENE_SHADOW_ROOM = 8
export const SCENE_IMAGE_HEIGHT = SCENE_PILL_HEIGHT + SCENE_SHADOW_ROOM * 2
/** Between the subtitle's text box and the pill (the subtitle image's own bottom padding comes off it). */
export const SCENE_GAP = 8

/** The cue the label shows over (line 1's) and its words. */
export interface CueScene {
  cueId: string
  text: string
}

export interface SceneLabelLayout {
  /** As drawn: shortened with … when it would be wider than a subtitle. */
  text: string
  /** The pill's width, centered on the frame. */
  width: number
}

/** `hook` with the label on the first cue; unchanged without one. */
export function withScene(hook: HookOptions, cues: SubtitleCue[], scene: string | undefined): HookOptions {
  const text = scene?.trim()
  if (!text || cues.length === 0) return hook
  const first = cues.reduce((a, b) => (b.start < a.start ? b : a))
  return { ...hook, scene: { cueId: first.id, text } }
}

/** The label's words if it goes with `cueId`. */
export function sceneOf(hook: Pick<HookOptions, 'scene'> | undefined, cueId: string): string | undefined {
  return hook?.scene?.cueId === cueId ? hook.scene.text : undefined
}

export function layoutSceneLabel(text: string, measure: MeasureText): SceneLabelLayout {
  const room = SUBTITLE_TEXT_WIDTH - SCENE_PAD_X * 2
  let shown = text.trim()
  if (measure(shown, SCENE_FONT) > room) {
    const chars = Array.from(shown)
    while (chars.length > 1 && measure(`${chars.join('').trimEnd()}…`, SCENE_FONT) > room) chars.pop()
    shown = `${chars.join('').trimEnd()}…`
  }
  return { text: shown, width: Math.ceil(measure(shown, SCENE_FONT)) + SCENE_PAD_X * 2 }
}

/**
 * Where the label image's top goes (output px), under a subtitle image
 * placed at `cueY`, `cueHeight` tall; kept on screen.
 */
export function sceneLabelY(cueY: number, cueHeight: number): number {
  const under = cueY + cueHeight - SUBTITLE_PADDING_Y + SCENE_GAP - SCENE_SHADOW_ROOM
  return Math.round(Math.max(0, Math.min(SUBTITLE_VIDEO_HEIGHT - SCENE_IMAGE_HEIGHT, under)))
}
