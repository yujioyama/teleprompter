import { DEFAULT_CARD_BACKGROUND, isCardBackgroundName, type CardBackgroundName, type InboxCard } from '../../shared/inbox'
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

/** A card's voice (挿入カードの声) starts this far in: after the pop. */
export const CARD_VOICE_START_S = 0.25
/** The card stays up this long after its voice ends. */
export const CARD_VOICE_TAIL_S = 0.2

/** How long a card is up with a voice `voiceSeconds` long (none: CARD_SECONDS). Never shorter than CARD_SECONDS. */
export function cardSecondsFor(voiceSeconds: number | undefined): number {
  return voiceSeconds === undefined ? CARD_SECONDS : Math.max(CARD_SECONDS, CARD_VOICE_START_S + voiceSeconds + CARD_VOICE_TAIL_S)
}

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

/**
 * The backgrounds, by name. grape and night are dark and mottled, with
 * blotches of `blotches` and a spray of fine specks, like a hand-painted
 * cartoon card; paper is flat with faint grain; peach and mint are soft
 * two-stop gradients.
 */
export interface CardBackgroundLook {
  top: string
  bottom: string
  text: string
  texture: 'mottled' | 'grain' | 'none'
  blotches?: string[]
  specks?: string
}

export const CARD_BACKGROUND_COLORS: Record<CardBackgroundName, CardBackgroundLook> = {
  grape: {
    top: '#4A2A63', bottom: '#2E1A44', text: '#D4EDB0', texture: 'mottled',
    blotches: ['rgba(120, 70, 150, 0.35)', 'rgba(30, 14, 46, 0.45)', 'rgba(160, 90, 120, 0.22)', 'rgba(70, 110, 80, 0.18)'],
    specks: 'rgba(214, 196, 120, 0.35)',
  },
  night: {
    top: '#1F3550', bottom: '#14223A', text: '#F7E7A8', texture: 'mottled',
    blotches: ['rgba(60, 100, 140, 0.35)', 'rgba(8, 16, 30, 0.45)', 'rgba(110, 80, 140, 0.2)', 'rgba(40, 120, 120, 0.18)'],
    specks: 'rgba(240, 230, 180, 0.3)',
  },
  paper: { top: '#F6EFE2', bottom: '#F6EFE2', text: '#3A3330', texture: 'grain' },
  peach: { top: '#FFE3E8', bottom: '#FFD6BE', text: '#4A3036', texture: 'none' },
  mint: { top: '#DDF5EC', bottom: '#CFE6FA', text: '#23403A', texture: 'none' },
}

export const CARD_BACKGROUND_LABELS: Record<CardBackgroundName, string> = {
  grape: 'ぶどう色のまだら',
  night: '夜の紺のまだら',
  paper: '紙（無地）',
  peach: 'ピンクのグラデーション',
  mint: 'ミントのグラデーション',
}

export const DEFAULT_CARD_TEXT = '2 days later'

/** What a card's background is: one of the app's, or an image by its URL. */
export type CardBackground = { kind: 'named'; name: CardBackgroundName } | { kind: 'image'; url: string }

export function cardBackgroundOf(background: string | undefined): CardBackground {
  if (background && /^https:\/\//.test(background)) return { kind: 'image', url: background }
  return { kind: 'named', name: isCardBackgroundName(background) ? background : DEFAULT_CARD_BACKGROUND }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

/** How big letter `index` is `t` seconds into the card: popping in, then 1. */
export function letterScale(index: number, t: number): number {
  return popScaleAt(t - index * POP_STAGGER_SECONDS)
}

/** How big a letter is `since` seconds after its pop started: 0 before, up past full size, then 1. */
export function popScaleAt(since: number): number {
  const local = since / POP_SECONDS
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

// ---- The spooky card (2026-11-22) ----

/**
 * A card on grape, the default, is spooky: pale purple fog drifts behind the
 * letters, the light flickers like a dying bulb, the letters shiver instead
 * of wobbling, and its sound is a hush of air with a far voice in it (see
 * cardMistSamples) while the BGM goes silent. The other backgrounds are
 * as they were.
 */
export function isSpookyCard(background: CardBackground): boolean {
  return background.kind === 'named' && background.name === 'grape'
}

/** The flickers in one round of FLICKER_EVERY_S: [start, length] in seconds, each a dip in the light. */
export const FLICKERS: readonly (readonly [number, number])[] = [
  [0.55, 0.05],
  [0.63, 0.04],
  [1.25, 0.1],
]
/** The flickers come round again this often, on a card held longer for its voice. */
export const FLICKER_EVERY_S = 1.3
/** How dark a flicker makes the card: the share of light it takes away. */
export const FLICKER_DIP = 0.55

/** How much of the light a flicker takes away `t` seconds into the card: FLICKER_DIP during one, else 0. */
export function flickerAt(t: number): number {
  if (t < 0) return 0
  const local = t % FLICKER_EVERY_S
  return FLICKERS.some(([start, length]) => local >= start && local < start + length) ? FLICKER_DIP : 0
}

/** How far a shivering letter moves, as a share of the font size, and how far it turns, in degrees. */
export const SHIVER_SHARE = 0.025
export const SHIVER_DEGREES = 1.5

/** Letter `index`'s shiver `t` seconds in: a new small jolt every frame (30 a second), the same on every draw. */
export function letterShiver(index: number, t: number): { dx: number; dy: number; rotate: number } {
  const next = random(hash(`shiver:${Math.floor(t * 30)}:${index}`))
  return { dx: (next() - 0.5) * 2 * SHIVER_SHARE, dy: (next() - 0.5) * 2 * SHIVER_SHARE, rotate: (next() - 0.5) * 2 * SHIVER_DEGREES }
}

/** One puff of fog: where it starts and how big, as shares of the card's width and height, and how it moves. */
export interface FogPuff {
  x: number
  y: number
  /** Radius, as a share of the width. */
  r: number
  /** Across, in widths a second. */
  speed: number
  phase: number
}

/** How fast the fog rises, in widths a second; and its color. */
export const FOG_RISE = 0.12
export const FOG_COLOR = '205, 180, 225'
export const FOG_ALPHA = 0.22

export const FOG_PUFFS: readonly FogPuff[] = (() => {
  const next = random(hash('fog'))
  return Array.from({ length: 16 }, () => ({
    x: next(),
    y: 0.55 + next() * 0.5,
    r: 0.2 + next() * 0.3,
    speed: 0.19 + next() * 0.23,
    phase: next() * Math.PI * 2,
  }))
})()

/** Where puff `puff` is `t` seconds in, in px on a `width` × `height` card: drifting across (round again past the edge) and rising. */
export function fogPuffAt(puff: FogPuff, t: number, width: number, height: number): { x: number; y: number; r: number } {
  const r = puff.r * width
  const span = width + 2 * r
  const x = ((((puff.x * width + t * puff.speed * width) % span) + span) % span) - r
  const y = puff.y * height - Math.sin(t * 2.2 + puff.phase) * width * 0.04 - t * FOG_RISE * width
  return { x, y, r }
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
    const ja = card.ja?.trim()
    return [{ id: newId(), afterShotId: shot.id, text: card.text, ...(card.background ? { background: card.background } : {}), ...(ja ? { ja } : {}) }]
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

/** The card's text as written, on one line (it's laid out again when drawn). */
export function cardTextOf(text: string): string {
  return takeLinesOf(text).join(' ').trim()
}

/** Longer than this, the text goes on two lines, split at the space nearest its middle. */
export const CARD_ONE_LINE_MAX = 8

/** The card's lines as drawn: in capitals, one line, or two when it's long. */
export function cardLinesOf(text: string): string[] {
  const shown = cardTextOf(text).toUpperCase()
  if (shown.length <= CARD_ONE_LINE_MAX || !shown.includes(' ')) return [shown]
  const middle = shown.length / 2
  let best = -1
  for (let i = 0; i < shown.length; i++) {
    if (shown[i] === ' ' && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i
  }
  return [shown.slice(0, best).trim(), shown.slice(best + 1).trim()]
}

/**
 * How each letter is cut, for a hand-made comic look: a little turned, a
 * little taller or narrower, a little up or down, each its own way. Fixed
 * for the whole card (the wobbles go on top), and seeded by the text.
 */
export interface LetterCut {
  rotate: number
  scaleX: number
  scaleY: number
  /** As a share of the font size; down is positive. */
  dy: number
}

export function letterCutsOf(text: string): LetterCut[] {
  const next = random(hash(`cut:${text}`))
  return [...text].map(() => ({
    rotate: (next() - 0.5) * 14,
    scaleX: 0.84 + next() * 0.18,
    scaleY: 1.1 + next() * 0.4,
    dy: (next() - 0.5) * 0.16,
  }))
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

/**
 * The cards' spans on the joined timeline, in seconds: where the BGM goes
 * soft, or silent for a card `silent` says so of (a spooky one).
 */
export function cardSpansOf(
  clips: { shotId: string; start: number; end: number }[],
  silent: (clip: { shotId: string }) => boolean = () => false,
): { start: number; end: number; silent?: true }[] {
  const spans: { start: number; end: number; silent?: true }[] = []
  let offset = 0
  for (const clip of clips) {
    const duration = clip.end - clip.start
    if (isCardClip(clip)) spans.push({ start: offset, end: offset + duration, ...(silent(clip) ? { silent: true as const } : {}) })
    offset += duration
  }
  return spans
}

/** Whether a clip is one of `script`'s spooky cards' (isSpookyCard): the BGM is silent through those. */
export function spookyCardClipsOf(script: Pick<Script, 'cards'> | undefined): (clip: { shotId: string }) => boolean {
  const ids = new Set((script?.cards ?? []).filter(card => isSpookyCard(cardBackgroundOf(card.background))).map(card => cardClipId(card.id)))
  return clip => ids.has(clip.shotId)
}

/** A card's subtitle input: nothing to say, only time to take up. */
export function cardCueInput(duration: number): ShotCueInput {
  return { text: '', duration, card: true }
}

/**
 * The shots as the camera app is given them: each one a card follows says
 * so (`cardAfter`, its text), for the camera to show where the card goes.
 * Nothing is filmed for a card. The first shot carries the 冒頭カード's
 * sentence (`openingBefore`), whose voice the camera records ahead.
 */
export function camShotsOf(script: Pick<Script, 'cards' | 'oneTake' | 'shots' | 'opening'>, shots: Shot[] = script.shots): (Shot & { cardAfter?: string; openingBefore?: string })[] {
  const cards = cardsInOrder(script)
  // 冒頭カード: its sentence on the first line, for its voice to be recorded ahead.
  const opening = script.opening?.text.trim()
  const firstId = script.shots[0]?.id
  return shots.map(shot => {
    const card = cards.find(c => c.card.afterShotId === shot.id)
    const withCard = card ? { ...shot, cardAfter: cardTextOf(card.card.text) } : shot
    return opening && shot.id === firstId ? { ...withCard, openingBefore: opening } : withCard
  })
}

/** The text of the card that follows `shotId`, or undefined for none. */
export function cardAfterShot(script: Pick<Script, 'cards' | 'oneTake' | 'shots'>, shotId: string): string | undefined {
  const found = cardsInOrder(script).find(c => c.card.afterShotId === shotId)
  return found ? cardTextOf(found.card.text) : undefined
}
