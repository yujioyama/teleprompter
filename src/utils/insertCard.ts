import { isCardBackgroundName, type CardBackgroundName, type InboxCard } from '../../shared/inbox'
import { takeLinesOf } from './subtitleCues'
import { hash, random } from './seededRandom'
import type { CardAudio, Script, ScriptCard, Shot } from '../types'
import type { ShotCueInput } from './subtitleCues'

/**
 * 挿入カード ("2 days later"): a short full-screen card between two lines,
 * shown in place of the takes. The burn, the editor's preview and the
 * combine all read the same timing from here, so they agree.
 */

/** How long a card is up, in seconds. */
export const CARD_SECONDS = 1.8

/** Each letter pops in this long, from POP_FROM to a little past full size and back. */
export const POP_SECONDS = 0.22
/** The next letter's pop starts this much later than the one before. */
export const POP_STAGGER_SECONDS = 0.025
const POP_FROM = 0.55
const POP_OVERSHOOT = 1.08

/** When the first wobble starts, once the letters are in. */
export const WOBBLE_START_SECONDS = 0.38
/** A new wobble every this many seconds. */
export const WOBBLE_EVERY_SECONDS = 0.28
/** How long one letter takes to tilt and come back. */
export const TILT_SECONDS = 0.18
export const TILT_MIN_DEGREES = 8
export const TILT_MAX_DEGREES = 12

/** The backgrounds, by name: a flat paper or a soft two-stop gradient. */
export const CARD_BACKGROUND_COLORS: Record<CardBackgroundName, { top: string; bottom: string; text: string; grain: boolean }> = {
  paper: { top: '#F6EFE2', bottom: '#F6EFE2', text: '#3A3330', grain: true },
  peach: { top: '#FFE3E8', bottom: '#FFD6BE', text: '#4A3036', grain: false },
  mint: { top: '#DDF5EC', bottom: '#CFE6FA', text: '#23403A', grain: false },
}

export const CARD_BACKGROUND_LABELS: Record<CardBackgroundName, string> = {
  paper: '紙（無地）',
  peach: 'ピンクのグラデーション',
  mint: 'ミントのグラデーション',
}

export const DEFAULT_CARD_TEXT = '2 days later'

/** What a card's background is: one of the app's, or an image by its URL. */
export type CardBackground = { kind: 'named'; name: CardBackgroundName } | { kind: 'image'; url: string }

export function cardBackgroundOf(background: string | undefined): CardBackground {
  if (background && /^https:\/\//.test(background)) return { kind: 'image', url: background }
  return { kind: 'named', name: isCardBackgroundName(background) ? background : 'paper' }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

/** How big letter `index` is `t` seconds into the card: popping in, then 1. */
export function letterScale(index: number, t: number): number {
  const local = (t - index * POP_STAGGER_SECONDS) / POP_SECONDS
  if (local <= 0) return 0
  if (local >= 1) return 1
  // Up past full size for the first 70%, then settling back.
  if (local < 0.7) return POP_FROM + (POP_OVERSHOOT - POP_FROM) * easeOut(local / 0.7)
  return POP_OVERSHOOT + (1 - POP_OVERSHOOT) * ((local - 0.7) / 0.3)
}

/** One wobble: which letters tilt, which way and how far, and when. */
export interface Wobble {
  start: number
  /** Indexes into the card's text. */
  letters: number[]
  /** Degrees per letter, signed. */
  angles: number[]
}

/**
 * Every wobble while the card is up: one or two letters at a time, never
 * spaces, and never the same as the wobble before, so it looks like the
 * letters take turns being silly. Seeded by the text, so the editor's
 * preview and the burned video wobble the same letters.
 */
export function wobblesOf(text: string, seconds = CARD_SECONDS): Wobble[] {
  const candidates = [...text].flatMap((ch, i) => (ch.trim() ? [i] : []))
  if (candidates.length === 0) return []
  const next = random(hash(`card:${text}`))
  const wobbles: Wobble[] = []
  let previous: number[] = []
  for (let start = WOBBLE_START_SECONDS; start + TILT_SECONDS <= seconds; start += WOBBLE_EVERY_SECONDS) {
    const fresh = candidates.filter(i => !previous.includes(i))
    const pool = fresh.length > 0 ? fresh : candidates
    const count = pool.length > 1 && next() < 0.45 ? 2 : 1
    const letters: number[] = []
    while (letters.length < count) {
      const pick = pool[Math.floor(next() * pool.length)]
      if (!letters.includes(pick)) letters.push(pick)
    }
    letters.sort((a, b) => a - b)
    const angles = letters.map(() => (next() < 0.5 ? -1 : 1) * (TILT_MIN_DEGREES + next() * (TILT_MAX_DEGREES - TILT_MIN_DEGREES)))
    wobbles.push({ start, letters, angles })
    previous = letters
  }
  return wobbles
}

/** Letter `index`'s tilt in degrees `t` seconds in: out and back along half a sine. */
export function letterTilt(wobbles: Wobble[], index: number, t: number): number {
  for (const wobble of wobbles) {
    const local = (t - wobble.start) / TILT_SECONDS
    if (local < 0 || local > 1) continue
    const at = wobble.letters.indexOf(index)
    if (at >= 0) return wobble.angles[at] * Math.sin(Math.PI * local)
  }
  return 0
}

/** The cards that go in a script's video, in order, each with the line it follows (from 1). */
export function cardsInOrder(script: Pick<Script, 'cards' | 'oneTake' | 'shots'>): { card: ScriptCard; afterLine: number }[] {
  if (script.oneTake || !script.cards?.length) return []
  const lineOf = new Map(script.shots.map((shot, i) => [shot.id, i + 1]))
  return script.cards
    .flatMap(card => {
      const afterLine = lineOf.get(card.afterShotId)
      // Not after the last line: a card sits between two.
      return afterLine !== undefined && afterLine < script.shots.length ? [{ card, afterLine }] : []
    })
    .sort((a, b) => a.afterLine - b.afterLine)
}

/** The cards Claude sent, onto the script's shots (one per line as sent). */
export function cardsOfInbox(cards: InboxCard[] | undefined, shots: Shot[], newId: () => string): ScriptCard[] {
  return (cards ?? []).flatMap(card => {
    const shot = shots[card.afterLine - 1]
    if (!shot || card.afterLine >= shots.length) return []
    return [{ id: newId(), afterShotId: shot.id, text: card.text, ...(card.background ? { background: card.background } : {}) }]
  })
}

/** Both on when the script says nothing. */
export function cardAudioOf(script: Pick<Script, 'cardAudio'> | undefined): CardAudio {
  return script?.cardAudio ?? { muffle: true, sound: true }
}

/** The lines (from 1) of a script Claude sent that are 心の声, as the script's lines stand now. */
export function thoughtLinesOfShots(shots: Shot[]): number[] {
  return shots.flatMap((shot, i) => (shot.thought ? [i + 1] : []))
}

/** For the record: each card's text and the line it came after. */
export function cardRecordsOf(script: Pick<Script, 'cards' | 'oneTake' | 'shots'>): { afterLine: number; text: string }[] {
  return cardsInOrder(script).map(({ card, afterLine }) => ({ afterLine, text: card.text }))
}

/** One line of the card's text, as the burn has room for it. */
export function cardTextOf(text: string): string {
  return takeLinesOf(text).join(' ').trim()
}

/** The image URLs a list of cards uses as backgrounds; they are kept on the device as line images are. */
export function cardImageUrlsOf(cards: { background?: string }[] | undefined): string[] {
  return (cards ?? []).flatMap(card => {
    const background = cardBackgroundOf(card.background)
    return background.kind === 'image' ? [background.url] : []
  })
}

/** A card's clip is named after it, so it can be told apart from a shot's anywhere along the way. */
const CARD_PREFIX = 'card-'

export function cardClipId(cardId: string): string {
  return `${CARD_PREFIX}${cardId}`
}

export function isCardClip(clip: { shotId: string }): boolean {
  return clip.shotId.startsWith(CARD_PREFIX)
}

/** The cards' spans on the joined timeline, in seconds: where the BGM goes soft. */
export function cardSpansOf(clips: { shotId: string; start: number; end: number }[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  let offset = 0
  for (const clip of clips) {
    const duration = clip.end - clip.start
    if (isCardClip(clip)) spans.push({ start: offset, end: offset + duration })
    offset += duration
  }
  return spans
}

/** A card's subtitle input: nothing to say, only time to take up. */
export function cardCueInput(duration: number): ShotCueInput {
  return { text: '', duration, card: true }
}

/**
 * The shots as the camera app is given them: each one a card follows says
 * so (`cardAfter`, its text), for the camera to show where the card goes.
 * Nothing is filmed for a card.
 */
export function camShotsOf(script: Pick<Script, 'cards' | 'oneTake' | 'shots'>, shots: Shot[] = script.shots): (Shot & { cardAfter?: string })[] {
  const cards = cardsInOrder(script)
  return shots.map(shot => {
    const card = cards.find(c => c.card.afterShotId === shot.id)
    return card ? { ...shot, cardAfter: cardTextOf(card.card.text) } : shot
  })
}

/** The text of the card that follows `shotId`, or undefined for none. */
export function cardAfterShot(script: Pick<Script, 'cards' | 'oneTake' | 'shots'>, shotId: string): string | undefined {
  const found = cardsInOrder(script).find(c => c.card.afterShotId === shotId)
  return found ? cardTextOf(found.card.text) : undefined
}
