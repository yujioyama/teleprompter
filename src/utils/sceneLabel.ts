import type { SubtitleCue } from './subtitleCues'
import type { HookOptions } from './subtitleHook'
import { SUBTITLE_FONT_FAMILY, SUBTITLE_PADDING_Y, SUBTITLE_TEXT_WIDTH, type MeasureText } from './subtitleLayout'
import { LINE_IMAGE_SLOT } from './lineImages'
import { letterboxBarHeight } from './openingLook'
import { SUBTITLE_POSITION_CENTER, SUBTITLE_VIDEO_HEIGHT, type SubtitlePosition } from './subtitlePosition'

/**
 * 状況のラベル: a few words on where a conversation happens ("a wrong
 * number", "online meeting"), shown over line 1 only, in place of line 1's
 * image (line 1 then has none, and its subtitle is on the chest): a dark
 * pill that starts with a yellow SCENE tag (so the words read as the
 * setting, not a line), then the words in white. See sceneUnder for where
 * it goes when line 1 is up top after all.
 */
export const SCENE_MAX_LENGTH = 40
export const SCENE_FONT_PX = 52
export const SCENE_FONT = `700 ${SCENE_FONT_PX}px ${SUBTITLE_FONT_FAMILY}`
export const SCENE_PAD_Y = 12
export const SCENE_PILL_HEIGHT = Math.round(SCENE_FONT_PX * 1.2) + SCENE_PAD_Y * 2
export const SCENE_FILL = 'rgba(0, 0, 0, 0.78)'
/** The SCENE tag at the pill's start. */
export const SCENE_TAG = 'SCENE'
export const SCENE_TAG_FONT_PX = 32
export const SCENE_TAG_FONT = `800 ${SCENE_TAG_FONT_PX}px ${SUBTITLE_FONT_FAMILY}`
export const SCENE_TAG_FILL = '#ffd23f'
export const SCENE_TAG_COLOR = '#111'
/** Between the pill's edge and the tag, all round. */
export const SCENE_TAG_INSET = 9
export const SCENE_TAG_HEIGHT = SCENE_PILL_HEIGHT - SCENE_TAG_INSET * 2
export const SCENE_TAG_PAD_X = 18
/** Between the tag and the words. */
export const SCENE_TAG_GAP = 18
/** After the words, to the pill's end. */
export const SCENE_PAD_RIGHT = 30
/** Room around the pill for its shadow, in the label image. */
export const SCENE_SHADOW_ROOM = 8
export const SCENE_IMAGE_HEIGHT = SCENE_PILL_HEIGHT + SCENE_SHADOW_ROOM * 2
/** Between the subtitle's text box and the pill (the subtitle image's own bottom padding comes off it). */
export const SCENE_GAP = 10

/** The cue the label shows over (line 1's) and its words. */
export interface CueScene {
  cueId: string
  text: string
}

export interface SceneLabelLayout {
  /** As drawn: shortened with … when the pill would be wider than a subtitle. */
  text: string
  /** The pill's width, centered on the frame. */
  width: number
  /** The SCENE tag's width; it starts SCENE_TAG_INSET in from the pill's left. */
  tagWidth: number
  /** Where the words start, from the pill's left. */
  textLeft: number
}

/** `hook` with the label on the first cue; unchanged without one. */
export function withScene(hook: HookOptions, cues: SubtitleCue[], scene: string | undefined): HookOptions {
  const text = scene?.trim()
  if (!text || cues.length === 0) return hook
  const first = cues.reduce((a, b) => (b.start < a.start ? b : a))
  // Line 1 shows while the bars are up: keep them off the label, as off a line's image.
  const bars = letterboxBarHeight([LINE_IMAGE_SLOT.top])
  const opening = hook.opening && hook.opening.height > bars ? { ...hook.opening, height: bars } : hook.opening
  return { ...hook, opening, scene: { cueId: first.id, text } }
}

/** The label's words if it goes with `cueId`. */
export function sceneOf(hook: Pick<HookOptions, 'scene'> | undefined, cueId: string): string | undefined {
  return hook?.scene?.cueId === cueId ? hook.scene.text : undefined
}

export function layoutSceneLabel(text: string, measure: MeasureText): SceneLabelLayout {
  const tagWidth = Math.ceil(measure(SCENE_TAG, SCENE_TAG_FONT)) + SCENE_TAG_PAD_X * 2
  const textLeft = SCENE_TAG_INSET + tagWidth + SCENE_TAG_GAP
  const room = SUBTITLE_TEXT_WIDTH - textLeft - SCENE_PAD_RIGHT
  let shown = text.trim()
  if (measure(shown, SCENE_FONT) > room) {
    const chars = Array.from(shown)
    while (chars.length > 1 && measure(`${chars.join('').trimEnd()}…`, SCENE_FONT) > room) chars.pop()
    shown = `${chars.join('').trimEnd()}…`
  }
  return { text: shown, width: textLeft + Math.ceil(measure(shown, SCENE_FONT)) + SCENE_PAD_RIGHT, tagWidth, textLeft }
}

/**
 * Whether the label goes right under the subtitle centered at `position`:
 * in the upper half it does (above it would be under the SNS header). Lower
 * down (line 1 with a label is on the chest, see subtitlePositionOf) it goes
 * in the line image's place instead, between the SNS header and the head:
 * under the subtitle it would run into the SNS caption, above it onto the eyes.
 */
export function sceneUnder(position: SubtitlePosition): boolean {
  return position <= SUBTITLE_POSITION_CENTER
}

/** The pill's top in the line image's place: centered in its slot. */
export const SCENE_TOP_BAND_Y = Math.round(LINE_IMAGE_SLOT.top + (LINE_IMAGE_SLOT.height - SCENE_PILL_HEIGHT) / 2)

/**
 * Where the label image's top goes (output px), for a subtitle image placed
 * at `cueY`, `cueHeight` tall, centered at `position`; kept on screen.
 */
export function sceneLabelY(cueY: number, cueHeight: number, position: SubtitlePosition): number {
  const y = sceneUnder(position)
    ? cueY + cueHeight - SUBTITLE_PADDING_Y + SCENE_GAP - SCENE_SHADOW_ROOM
    : SCENE_TOP_BAND_Y - SCENE_SHADOW_ROOM
  return Math.round(Math.max(0, Math.min(SUBTITLE_VIDEO_HEIGHT - SCENE_IMAGE_HEIGHT, y)))
}
