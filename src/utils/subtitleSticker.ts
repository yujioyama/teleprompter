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
 * Where the sticker goes on the 1080×1920 output (x as a fraction of the
 * width, y as a percent of the height, like subtitle positions), tilted a
 * little so it reads as stuck on rather than part of the picture.
 * - chest: below the chin, centered, clear of the face, the hook subtitle
 *   at the top and the TikTok/Reels button column on the right
 * - left / right: beside the face
 * - off: no sticker, and the emoji is still kept out of the text
 */
export type StickerPlacement = 'chest' | 'left' | 'right' | 'off'
export const STICKER_PLACEMENTS: Record<Exclude<StickerPlacement, 'off'>, { x: number; y: number; rotation: number }> = {
  chest: { x: 0.5, y: 66, rotation: -6 },
  left: { x: 0.18, y: 42, rotation: -8 },
  right: { x: 0.82, y: 42, rotation: 8 },
}
export const DEFAULT_STICKER_PLACEMENT: StickerPlacement = 'chest'

export const STICKER_EMOJI_PX = 220
/** The white border around it, like a die-cut sticker. */
export const STICKER_OUTLINE_PX = 14
export const STICKER_SHADOW = { color: 'rgba(0,0,0,0.35)', blur: 24, offsetY: 8 }
/** Height of the full-width overlay image that carries the sticker. */
export const STICKER_IMAGE_HEIGHT = 420

export const EMOJI_FONT_FAMILY = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
