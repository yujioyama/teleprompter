/**
 * An emoji in the first shot's subtitle (e.g. `I put *Vaseline*🧴 on…`) is
 * not drawn in the text: it becomes a big sticker beside the face, shown
 * from the very first frame until the first shot ends, so the feed's first
 * frame already has something to stop on.
 */

// One emoji as people type it: a pictograph plus any variation selector,
// skin tone or ZWJ-joined pictographs after it (👨‍🍳, 👍🏽, ❤️).
const EMOJI = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/u

/** The first emoji in `text`, or null. */
export function findSticker(text: string): string | null {
  return EMOJI.exec(text)?.[0] ?? null
}

/** `text` without its emoji, with the spaces they leave tidied up. */
export function stripStickers(text: string): string {
  return text
    .replace(new RegExp(EMOJI.source, 'gu'), ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?;:)])/g, '$1')
    .trim()
}

/** The sticker of the first hook cue that has an emoji, or null. */
export function stickerOf(cues: { en: string; variant: string }[]): string | null {
  for (const cue of cues) {
    if (cue.variant !== 'hook') continue
    const sticker = findSticker(cue.en)
    if (sticker) return sticker
  }
  return null
}

/**
 * Cues transcribed from speech have no emoji, so put the first script
 * line's one back at the end of the first cue (if it doesn't have one).
 */
export function reapplySticker<T extends { en: string }>(cues: T[], scriptTexts: string[]): T[] {
  const sticker = scriptTexts.length > 0 ? findSticker(scriptTexts[0]) : null
  if (!sticker || cues.length === 0 || findSticker(cues[0].en)) return cues
  return [{ ...cues[0], en: `${cues[0].en}${sticker}` }, ...cues.slice(1)]
}

/**
 * Geometry on the 1080×1920 output. The sticker sits beside the face, on
 * the right and just above the TikTok/Reels button column (which starts at
 * about half the height), about a quarter of the frame wide, tilted a little
 * so it reads as stuck on rather than part of the picture.
 */
export const STICKER_EMOJI_PX = 250
/** The white border around it, like a die-cut sticker. */
export const STICKER_OUTLINE_PX = 14
export const STICKER_CENTER_X = 0.78
/** Percent of the video height (as subtitle positions are). */
export const STICKER_CENTER_Y = 37
export const STICKER_ROTATION_DEG = -8
export const STICKER_SHADOW = { color: 'rgba(0,0,0,0.35)', blur: 24, offsetY: 8 }
/** Height of the full-width overlay image that carries the sticker. */
export const STICKER_IMAGE_HEIGHT = 420

export const EMOJI_FONT_FAMILY = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
