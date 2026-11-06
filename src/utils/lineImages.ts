import type { InboxImage } from '../../shared/inbox'
import type { LineImage } from '../types'
import { textSimilarity } from './reconcileShots'
import { lineKey, takeLinesOf, type SubtitleCue } from './subtitleCues'
import { stripEmphasis } from './subtitleEmphasis'
import type { HookOptions } from './subtitleHook'
import { SUBTITLE_FONT_FAMILY } from './subtitleLayout'
import { clampedSubtitleY } from './subtitlePosition'
import { stripStickers } from './subtitleSticker'

/**
 * An image picked for one script line, shown while that line's subtitle is
 * up. A script with one has no emoji stickers at all (see withLineImages).
 * Lines are matched by their text, so an image stays with its line when lines
 * are moved or added; the bytes live on this device (see lineImageStore).
 */

/** An image as this device has it. */
export interface StoredLineImage {
  id: string
  blob: Blob
  width: number
  height: number
}

/** An image to show over one cue's window; the cue is what times it. */
export interface CueImage {
  cueId: string
  imageId: string
  blob: Blob
  width: number
  height: number
  credit?: string
  /** The first line's: small, so the face and the opening's bars are what's seen. */
  small?: boolean
}

// How alike a line and a subtitle must be to be the same words (as reconcileShots).
const MIN_SIMILARITY = 0.5

const plainText = (text: string) => stripStickers(stripEmphasis(text))

/** The images Claude sent, on the lines of `body` they were sent for. */
export function lineImagesOf(body: string, images: InboxImage[]): LineImage[] {
  const lines = takeLinesOf(body)
  return images.flatMap(({ line, url, credit }) => {
    const en = lines[line - 1]
    return en === undefined ? [] : [{ en, imageId: url, url, ...(credit ? { credit } : {}) }]
  })
}

/** Each line's image, or null. Twin lines take their images in turn. */
export function assignToLines(images: LineImage[], lines: string[]): (LineImage | null)[] {
  const left = [...images]
  return lines.map(line => {
    const at = left.findIndex(image => lineKey(image.en) === lineKey(line))
    return at < 0 ? null : left.splice(at, 1)[0]
  })
}

/**
 * The images after the script's lines were edited to `lines`: on the same
 * text first, then on the closest line left. An image with no line close to
 * its own has lost its line and goes.
 */
export function reconcileLineImages(images: LineImage[], lines: string[]): LineImage[] {
  const assigned = assignToLines(images, lines)
  const left = images.filter(image => !assigned.includes(image))
  const candidates = left.flatMap(image =>
    lines.flatMap((line, i) => {
      const score = assigned[i] ? 0 : textSimilarity(plainText(image.en), plainText(line))
      return score >= MIN_SIMILARITY ? [{ image, i, score }] : []
    }),
  )
  candidates.sort((a, b) => b.score - a.score)
  const placed = new Set<LineImage>()
  for (const { image, i } of candidates) {
    if (assigned[i] || placed.has(image)) continue
    placed.add(image)
    assigned[i] = { ...image, en: lines[i] }
  }
  return assigned.filter((image): image is LineImage => image !== null)
}

/** Which cue shows each line's image: by order when the cues are the lines, else by the closest words. */
function cueOfLine(cues: SubtitleCue[], lines: string[]): (line: number) => SubtitleCue | null {
  if (cues.length === lines.length) return line => cues[line] ?? null
  const used = new Set<SubtitleCue>()
  return line => {
    let best: SubtitleCue | null = null
    let bestScore = MIN_SIMILARITY
    for (const cue of cues) {
      if (used.has(cue)) continue
      const score = textSimilarity(plainText(cue.en), plainText(lines[line]))
      if (score >= bestScore) {
        best = cue
        bestScore = score
      }
    }
    if (best) used.add(best)
    return best
  }
}

/**
 * The hook for a script with images: no sticker, no fairies, no finale, even
 * while an image is still on its way to this device, and each image that is
 * here on its line's cue. A script without images keeps the hook as it was.
 * The sticker's emoji stays in the text, kept out of the subtitles as ever.
 */
export function withLineImages(
  hook: HookOptions,
  { images, stored, cues, lines }: { images: LineImage[]; stored: Map<string, StoredLineImage>; cues: SubtitleCue[]; lines: string[] },
): HookOptions {
  if (images.length === 0) return hook
  const cueOf = cueOfLine(cues, lines)
  const lineImages = assignToLines(images, lines).flatMap((image, i) => {
    const here = image && stored.get(image.imageId)
    const cue = here ? cueOf(i) : null
    if (!image || !here || !cue) return []
    const { blob, width, height } = here
    return [{
      cueId: cue.id,
      imageId: image.imageId,
      blob,
      width,
      height,
      ...(image.credit ? { credit: image.credit } : {}),
      ...(i === 0 ? { small: true } : {}),
    }]
  })
  return { ...hook, sticker: 'off', fairies: false, lineImages }
}

export interface LineImageSlot {
  left: number
  top: number
  width: number
  height: number
}

/**
 * For a subtitle too low to have room under it: the band between the feeds'
 * header and the head, on the 1080×1920 output.
 */
export const LINE_IMAGE_TOP_SLOT: LineImageSlot = { left: 230, top: 298, width: 620, height: 297 }

/**
 * The usual place, from the subtitle's bottom down to what Instagram's 4:5 feed
 * keeps (85%), over the face if it comes to that: a line's image is up only
 * for that line. 10% in from the sides, since TikTok zooms the video in on a
 * tall phone and cuts them off.
 */
const UNDER_SUBTITLE = { left: 108, width: 864, bottom: 1632 }

/**
 * The first line's place: the chest, between the face and the opening's bottom
 * bar at its thickest, and left of TikTok's buttons. A subtitle reaching past
 * `top` pushes it down.
 */
const ON_CHEST = { left: 340, width: 400, top: 1070, bottom: 1490 }

/** A subtitle centered below this percent leaves too little room under it. */
const SUBTITLE_TOO_LOW = 50

/** Where a line's image may go, given its subtitle's position and rendered height. */
export function lineImageSlot(subtitlePosition: number, subtitleHeight: number, small = false): LineImageSlot {
  if (subtitlePosition > SUBTITLE_TOO_LOW) return LINE_IMAGE_TOP_SLOT
  const subtitleBottom = clampedSubtitleY(subtitlePosition, subtitleHeight) + subtitleHeight
  const { left, width, bottom } = small ? ON_CHEST : UNDER_SUBTITLE
  const top = small ? Math.max(ON_CHEST.top, subtitleBottom) : subtitleBottom
  return { left, top, width, height: bottom - top }
}

export const LINE_IMAGE_FRAME = { width: 1080, height: 1920 }
export const LINE_IMAGE_RADIUS = 20
export const CREDIT_FONT_PX = 22
const CREDIT_LINE_PX = 28
const CREDIT_GAP = 6
const CREDIT_MAX_LINES = 3

export const CREDIT_FONT = `600 ${CREDIT_FONT_PX}px ${SUBTITLE_FONT_FAMILY}`

/** The credit broken at spaces to fit `width`; cut with … past a few lines. */
export function wrapCredit(credit: string | undefined, width: number, measure: (text: string) => number): string[] {
  if (!credit) return []
  const lines: string[] = []
  for (const word of credit.split(/\s+/).filter(Boolean)) {
    const joined = lines.length > 0 ? `${lines[lines.length - 1]} ${word}` : word
    if (lines.length > 0 && measure(joined) <= width) lines[lines.length - 1] = joined
    else lines.push(word)
  }
  const kept = lines.slice(0, CREDIT_MAX_LINES)
  return kept.map((line, i) => {
    const cut = lines.length > kept.length && i === kept.length - 1
    if (!cut && measure(line) <= width) return line
    let fitted = line
    while (fitted.length > 1 && measure(`${fitted}…`) > width) fitted = fitted.slice(0, -1)
    return `${fitted}…`
  })
}

/**
 * The image kept in shape as big as the slot allows above its credit: centered
 * across the slot, at its top. `height` is the image and credit together.
 */
export function layoutLineImage(width: number, height: number, creditLines: number, slot: LineImageSlot) {
  const creditHeight = creditLines > 0 ? CREDIT_GAP + creditLines * CREDIT_LINE_PX : 0
  const scale = Math.min(slot.width / width, (slot.height - creditHeight) / height)
  const drawn = { width: width * scale, height: height * scale }
  return {
    image: { x: slot.left + (slot.width - drawn.width) / 2, y: slot.top, ...drawn },
    height: drawn.height + creditHeight,
    creditCenterX: slot.left + slot.width / 2,
    creditTop: slot.top + drawn.height + CREDIT_GAP,
    creditLineHeight: CREDIT_LINE_PX,
  }
}
