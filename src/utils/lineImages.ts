import type { InboxImage } from '../../shared/inbox'
import type { LineImage } from '../types'
import { textSimilarity } from './reconcileShots'
import { lineKey, takeLinesOf, type SubtitleCue } from './subtitleCues'
import { stripEmphasis } from './subtitleEmphasis'
import type { HookOptions } from './subtitleHook'
import { SUBTITLE_FONT_FAMILY } from './subtitleLayout'
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
    return [{ cueId: cue.id, imageId: image.imageId, blob, width, height, ...(image.credit ? { credit: image.credit } : {}) }]
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
 * Where an image may go on the 1080×1920 output. `chest` is the usual place:
 * below the face (which ends about 55% down), where only hands and a mic are,
 * and above what Instagram's 4:5 feed crops off. `top` is the band between the
 * feeds' header and the head, for a subtitle that sits on the chest. Both stay
 * 10% in from the sides, since TikTok zooms the video in on a tall phone and
 * cuts them off.
 */
export const LINE_IMAGE_SLOTS = {
  chest: { left: 130, top: 1130, width: 820, height: 430 },
  top: { left: 230, top: 298, width: 620, height: 297 },
} satisfies Record<string, LineImageSlot>

/** A subtitle centered below this percent is in the chest slot's way. */
const SUBTITLE_IN_CHEST_SLOT = 50

export function lineImageSlot(subtitlePosition: number): LineImageSlot {
  return subtitlePosition > SUBTITLE_IN_CHEST_SLOT ? LINE_IMAGE_SLOTS.top : LINE_IMAGE_SLOTS.chest
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

/** The image kept in shape as big as the slot allows above its credit, the two centered in the slot. */
export function layoutLineImage(width: number, height: number, creditLines: number, slot: LineImageSlot) {
  const creditHeight = creditLines > 0 ? CREDIT_GAP + creditLines * CREDIT_LINE_PX : 0
  const scale = Math.min(slot.width / width, (slot.height - creditHeight) / height)
  const drawn = { width: width * scale, height: height * scale }
  const y = slot.top + (slot.height - drawn.height - creditHeight) / 2
  return {
    image: { x: slot.left + (slot.width - drawn.width) / 2, y, ...drawn },
    creditCenterX: slot.left + slot.width / 2,
    creditTop: y + drawn.height + CREDIT_GAP,
    creditLineHeight: CREDIT_LINE_PX,
  }
}
