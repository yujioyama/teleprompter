import type { SubtitleCue } from './subtitleCues'
import type { HookOptions } from './subtitleHook'
import { SUBTITLE_FONT_FAMILY, SUBTITLE_REFERENCE_WIDTH, type MeasureText } from './subtitleLayout'
import { LINE_IMAGE_SLOT } from './lineImages'
import { letterboxBarHeight } from './openingLook'

/**
 * 状況のラベル: a few words on where a conversation happens ("a wrong
 * number", "online meeting"), shown over line 1 only, in place of line 1's
 * image (line 1 then has none, and its subtitle is on the chest): a dark
 * pill that starts with a yellow SCENE tag (so the words read as the
 * setting, not a line), then the words in white, as big as fit.
 */
export const SCENE_MAX_LENGTH = 40
/** The words' size: as big as fits SCENE_MAX_WIDTH, down to the smallest. */
export const SCENE_FONT_MAX_PX = 80
export const SCENE_FONT_MIN_PX = 52
export const sceneFont = (px: number) => `700 ${px}px ${SUBTITLE_FONT_FAMILY}`
export const SCENE_PAD_Y = 16
export const SCENE_PILL_HEIGHT = Math.round(SCENE_FONT_MAX_PX * 1.2) + SCENE_PAD_Y * 2
export const SCENE_FILL = 'rgba(0, 0, 0, 0.78)'
/** The SCENE tag at the pill's start. */
export const SCENE_TAG = 'SCENE'
export const SCENE_TAG_FONT_PX = 42
export const SCENE_TAG_FONT = `800 ${SCENE_TAG_FONT_PX}px ${SUBTITLE_FONT_FAMILY}`
export const SCENE_TAG_FILL = '#ffd23f'
export const SCENE_TAG_COLOR = '#111'
/** Between the pill's edge and the tag, all round. */
export const SCENE_TAG_INSET = 12
export const SCENE_TAG_HEIGHT = SCENE_PILL_HEIGHT - SCENE_TAG_INSET * 2
export const SCENE_TAG_PAD_X = 24
/** Between the tag and the words. */
export const SCENE_TAG_GAP = 22
/** After the words, to the pill's end. */
export const SCENE_PAD_RIGHT = 40
/** The widest pill: 10% in from the sides, which TikTok cuts off on a tall phone. */
export const SCENE_MAX_WIDTH = Math.round(SUBTITLE_REFERENCE_WIDTH * 0.8)
/** Room around the pill for its shadow, in the label image. */
export const SCENE_SHADOW_ROOM = 8
export const SCENE_IMAGE_HEIGHT = SCENE_PILL_HEIGHT + SCENE_SHADOW_ROOM * 2
/** The label image's top (output px): the pill centered in line 1's image slot, which it takes over. */
export const SCENE_LABEL_Y = Math.round(LINE_IMAGE_SLOT.top + (LINE_IMAGE_SLOT.height - SCENE_PILL_HEIGHT) / 2) - SCENE_SHADOW_ROOM

/** The cue the label shows over (line 1's) and its words. */
export interface CueScene {
  cueId: string
  text: string
}

export interface SceneLabelLayout {
  /** As drawn: shortened with … when even the smallest size is too wide. */
  text: string
  /** The words' size. */
  fontPx: number
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
  const room = SCENE_MAX_WIDTH - textLeft - SCENE_PAD_RIGHT
  let shown = text.trim()
  let fontPx = SCENE_FONT_MAX_PX
  while (fontPx > SCENE_FONT_MIN_PX && measure(shown, sceneFont(fontPx)) > room) fontPx -= 2
  const font = sceneFont(fontPx)
  if (measure(shown, font) > room) {
    const chars = Array.from(shown)
    while (chars.length > 1 && measure(`${chars.join('').trimEnd()}…`, font) > room) chars.pop()
    shown = `${chars.join('').trimEnd()}…`
  }
  return { text: shown, fontPx, width: textLeft + Math.ceil(measure(shown, font)) + SCENE_PAD_RIGHT, tagWidth, textLeft }
}
