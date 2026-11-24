import { PHRASE_COLOR } from './subtitleEmphasis'
import type { ScriptOpening } from '../types'

/**
 * 冒頭カード: before line 1 plays, an indigo shop curtain (暖簾, with 「話」
 * and a 青海波 hem) hangs over the whole frame while one English sentence is
 * typed out on it, a letter at a time in a typewriter's font with a blinking
 * cursor, and its Japanese is typed under it over the same span. When the
 * voice is done, we walk through: the middle panels are pushed apart like
 * cloth and the curtain passes over our head into line 1. The burn, the
 * preview and the finished audio all read the same timing from here.
 *
 * The typing follows the recorded voice (the user's own, recorded in the
 * camera app): each word is typed as it's heard, from the word times the
 * camera's on-device recognition put in the file; without those, the letters
 * are spread over the voice, the last one a little before it ends; without a
 * voice, a letter every OPENING_MS_PER_CHAR.
 */

/** A recognized word's times, in seconds into the voice as it plays on the card. */
export interface OpeningWord {
  word: string
  start: number
  end: number
}

/** The card's voice as timing needs it. */
export interface OpeningVoiceTiming {
  /** How long the voice lasts (trimmed to its words, with a breath each side). */
  seconds: number
  /** Its words' times, from the voice's start; absent or empty when recognition got none. */
  words?: OpeningWord[]
}

export interface OpeningTiming {
  /** When each character of the text appears, seconds into the card. */
  charTimes: number[]
  /** When the last character is in. */
  typedEnd: number
  /** When the Japanese starts fading in. */
  jaAt: number
  /** When the voice starts (seconds into the card); null without one. */
  voiceAt: number | null
  /** When the 今日のフレーズ's meaning starts fading in; absent without one. */
  phraseJaAt?: number
  /** When the curtain starts to lift. */
  wipeAt: number
  /** The card's whole length, on the output frame grid. */
  seconds: number
}

/** Without a voice, a letter every this many seconds. */
export const OPENING_SECONDS_PER_CHAR = 0.04
/** The curtain is up, with the cursor blinking, this long before the first letter (no voice). */
export const OPENING_TYPE_START_S = 0.35
/** The voice starts this far in, once the curtain is seen. */
export const OPENING_VOICE_AT_S = 0.3
/** Spread over the voice, the last letter is in this long before it ends. */
export const OPENING_TYPE_BEFORE_END_S = 0.2
/** Without a voice, the card waits this long after the last letter (to read the Japanese)… */
export const OPENING_HOLD_S = 0.55
/** …with one, the curtain lifts this long after the voice ends, and at least OPENING_VOICE_HOLD_S after the last letter. */
export const OPENING_AFTER_VOICE_S = 0.15
export const OPENING_VOICE_HOLD_S = 0.3
/** The Japanese comes in this long after the last letter, and fades in over OPENING_JA_FADE_S. */
export const OPENING_JA_DELAY_S = 0.05
export const OPENING_JA_FADE_S = 0.4
/** The phrase's meaning comes in this long after the Japanese is all in, fades in over OPENING_PHRASE_JA_FADE_S, and is up at least OPENING_PHRASE_JA_HOLD_S before the curtain lifts. */
export const OPENING_PHRASE_JA_DELAY_S = 0.15
export const OPENING_PHRASE_JA_FADE_S = 0.3
export const OPENING_PHRASE_JA_HOLD_S = 0.7
/** 今日のフレーズ's pink, the lines' own (see subtitleEmphasis). */
export const OPENING_PHRASE_COLOR = PHRASE_COLOR
/** The curtain lifts over this long. */
export const OPENING_WIPE_S = 0.9
/** The card aims to be no longer than this; a longer voice stretches it. */
export const OPENING_TARGET_S = 4
/** A word is typed at least this fast, so a long-drawn word doesn't crawl. */
const MAX_SECONDS_PER_CHAR = 0.09

const FRAME_RATE = 30

const roundTime = (t: number) => Math.round(t * 1000) / 1000

/** The sentence's words as they stand in the text: where each starts and ends (end exclusive). */
export function wordSpansOf(text: string): { word: string; from: number; to: number }[] {
  const chars = [...text]
  const spans: { word: string; from: number; to: number }[] = []
  let from = -1
  chars.forEach((ch, i) => {
    const space = /\s/.test(ch)
    if (!space && from < 0) from = i
    if (space && from >= 0) {
      spans.push({ word: chars.slice(from, i).join(''), from, to: i })
      from = -1
    }
  })
  if (from >= 0) spans.push({ word: chars.slice(from).join(''), from, to: chars.length })
  return spans
}

const normalize = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Each of the text's words matched to the recognized word heard for it, in
 * order: recognition may miss a word, hear one that isn't there, or split
 * "3 a.m." differently, so a word is looked for only a few ahead. Unmatched:
 * null.
 */
export function matchWords(spans: { word: string }[], heard: OpeningWord[]): (OpeningWord | null)[] {
  let next = 0
  return spans.map(span => {
    const want = normalize(span.word)
    if (!want) return null
    for (let k = next; k < Math.min(heard.length, next + 3); k++) {
      const got = normalize(heard[k].word)
      if (got && (got === want || (want.length > 2 && (got.startsWith(want) || want.startsWith(got))))) {
        next = k + 1
        return heard[k]
      }
    }
    return null
  })
}

/** Characters spread evenly from `from` (the first) to `to` (the last). */
function spread(count: number, from: number, to: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [from]
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1))
}

/**
 * When each character appears, typed to the words as they're heard. The
 * words matched get their times; one missed gets a share of the time between
 * the matched words around it, by its length. A word's letters are spread
 * over the word, no slower than MAX_SECONDS_PER_CHAR; the spaces come in
 * with the letter before them. Null when not even one word matched.
 */
export function charTimesFromWords(text: string, words: OpeningWord[], voiceAt: number, voiceEnd: number): number[] | null {
  const chars = [...text]
  const spans = wordSpansOf(text)
  if (spans.length === 0) return null
  const matched = matchWords(spans, words)
  if (!matched.some(Boolean)) return null
  // Each word's [start, end], seconds into the card; missed ones filled in below.
  const times: ({ start: number; end: number } | null)[] = matched.map(m => (m ? { start: voiceAt + m.start, end: voiceAt + Math.max(m.start, m.end) } : null))
  let i = 0
  while (i < spans.length) {
    if (times[i]) {
      i++
      continue
    }
    let j = i
    while (j < spans.length && !times[j]) j++
    // Words i..j-1 were missed: between the end of the one before and the start of the one after.
    const from = i > 0 ? times[i - 1]!.end : voiceAt
    const to = j < spans.length ? times[j]!.start : Math.max(from, voiceEnd - OPENING_TYPE_BEFORE_END_S)
    const lengths = spans.slice(i, j).map(s => s.to - s.from)
    const total = lengths.reduce((a, b) => a + b, 0)
    let at = from
    for (let k = i; k < j; k++) {
      const share = ((to - from) * lengths[k - i]) / total
      times[k] = { start: at, end: at + share }
      at += share
    }
    i = j
  }
  const out = new Array<number>(chars.length).fill(0)
  let last = voiceAt
  spans.forEach((span, w) => {
    const { start, end } = times[w]!
    const count = span.to - span.from
    const room = Math.min(end - start, MAX_SECONDS_PER_CHAR * Math.max(0, count - 1))
    const letters = spread(count, Math.max(start, last), Math.max(start, last) + room)
    letters.forEach((t, k) => (out[span.from + k] = t))
    last = letters[letters.length - 1]
    // The spaces after the word come with its last letter.
    const nextFrom = w + 1 < spans.length ? spans[w + 1].from : chars.length
    for (let k = span.to; k < nextFrom; k++) out[k] = last
  })
  // Anything before the first word (leading spaces) comes with it.
  for (let k = 0; k < spans[0].from; k++) out[k] = out[spans[0].from]
  // Never later than the voice's end, and never out of order.
  const cap = voiceEnd - OPENING_TYPE_BEFORE_END_S
  let floor = 0
  return out.map(t => {
    floor = Math.max(floor, Math.min(t, Math.max(cap, voiceAt)))
    return roundTime(floor)
  })
}

/**
 * How the card looks (2026-11-22): 'stars', a calm night sky in the 挿入カード's
 * hand-cut lettering, cut straight to line 1; 'noren', the 暖簾 we walk through.
 */
export type OpeningStyle = 'stars' | 'noren'
export const OPENING_STYLES: readonly OpeningStyle[] = ['stars', 'noren']
export const OPENING_STYLE_LABELS: Record<OpeningStyle, string> = { stars: '星空', noren: '暖簾' }

/**
 * The card's timing for `text`, with the recorded voice or without one. The
 * 暖簾 takes OPENING_WIPE_S to walk through after `wipeAt`; the night sky
 * cuts to line 1 there.
 */
export function openingTimingOf(text: string, voice?: OpeningVoiceTiming | null, style: OpeningStyle = 'noren', withPhraseJa = false): OpeningTiming {
  const chars = [...text]
  let charTimes: number[]
  let voiceAt: number | null = null
  let voiceEnd = 0
  if (voice && voice.seconds > 0) {
    voiceAt = OPENING_VOICE_AT_S
    voiceEnd = voiceAt + voice.seconds
    const typedBy = Math.max(voiceAt, voiceEnd - OPENING_TYPE_BEFORE_END_S)
    charTimes = (voice.words?.length ? charTimesFromWords(text, voice.words, voiceAt, voiceEnd) : null)
      ?? spread(chars.length, voiceAt, typedBy).map(roundTime)
  } else {
    charTimes = chars.map((_, i) => roundTime(OPENING_TYPE_START_S + i * OPENING_SECONDS_PER_CHAR))
  }
  const typedEnd = charTimes.length > 0 ? charTimes[charTimes.length - 1] : OPENING_TYPE_START_S
  const jaAt = roundTime(typedEnd + OPENING_JA_DELAY_S)
  let wipeAt = roundTime(voiceAt !== null
    ? Math.max(voiceEnd + OPENING_AFTER_VOICE_S, typedEnd + OPENING_VOICE_HOLD_S)
    : typedEnd + OPENING_HOLD_S)
  // The phrase's meaning after the Japanese (typed alongside the English, so in by typedEnd).
  const phraseJaAt = withPhraseJa ? roundTime(typedEnd + OPENING_PHRASE_JA_DELAY_S) : undefined
  if (phraseJaAt !== undefined) wipeAt = roundTime(Math.max(wipeAt, phraseJaAt + OPENING_PHRASE_JA_HOLD_S))
  const seconds = Math.ceil((wipeAt + (style === 'noren' ? OPENING_WIPE_S : 0)) * FRAME_RATE - 1e-6) / FRAME_RATE
  return { charTimes, typedEnd, jaAt, voiceAt, ...(phraseJaAt !== undefined ? { phraseJaAt } : {}), wipeAt, seconds }
}

/** What the burn needs to draw the card and play its voice: all plain JSON, so it can sit in the hook. */
export interface OpeningCardPlan {
  text: string
  ja?: string
  /** 今日のフレーズ, as it stands in `text`; absent for none (or when it isn't in `text`). */
  phrase?: string
  /** Its meaning, under the Japanese; absent for none. */
  phraseJa?: string
  timing: OpeningTiming
  /** The prepared voice (see openingVoice.ts), by its key; absent for none. */
  voiceKey?: string
  /** Absent: the 暖簾 (a plan made before the night sky). */
  style?: OpeningStyle
}

export function openingCardPlanOf(
  opening: ScriptOpening | undefined,
  voice?: { key: string; timing: OpeningVoiceTiming } | null,
  style: OpeningStyle = 'noren',
): OpeningCardPlan | null {
  const text = opening?.text.trim()
  if (!text) return null
  const ja = opening?.ja?.trim()
  const range = phraseRangeOf(text, opening?.phrase)
  const phrase = range ? [...text].slice(range.from, range.to).join('') : undefined
  const phraseJa = phrase ? opening?.phraseJa?.trim() || undefined : undefined
  return {
    text,
    ...(ja ? { ja } : {}),
    ...(phrase ? { phrase } : {}),
    ...(phraseJa ? { phraseJa } : {}),
    timing: openingTimingOf(text, voice?.timing, style, !!phraseJa),
    ...(voice ? { voiceKey: voice.key } : {}),
    style,
  }
}

/**
 * Where `phrase` stands in `text`, in characters (end exclusive): the first
 * match, ignoring case and curly vs straight apostrophes; null for none.
 */
export function phraseRangeOf(text: string, phrase: string | undefined): { from: number; to: number } | null {
  const want = phrase?.trim()
  if (!want) return null
  const fold = (s: string) => [...s].map(ch => (ch === '\u2019' || ch === '\u2018' ? "'" : ch.toLowerCase())).join('')
  const chars = [...fold(text)]
  const needle = [...fold(want)]
  for (let i = 0; i + needle.length <= chars.length; i++) {
    if (needle.every((ch, k) => chars[i + k] === ch)) return { from: i, to: i + needle.length }
  }
  return null
}

/** `text` split into runs, the first match of `phrase` in it marked. */
export function phraseRunsOf(text: string, phrase: string | undefined): { text: string; phrase: boolean }[] {
  const at = phraseRangeOf(text, phrase)
  if (!at) return [{ text, phrase: false }]
  const chars = [...text]
  return [
    { text: chars.slice(0, at.from).join(''), phrase: false },
    { text: chars.slice(at.from, at.to).join(''), phrase: true },
    { text: chars.slice(at.to).join(''), phrase: false },
  ].filter(run => run.text)
}

// ---- Drawing ----

/** A typewriter's monospaced font, on every iPhone and Mac; the rest are stand-ins. */
export const OPENING_FONT_FAMILY = '"Courier New", Courier, Menlo, ui-monospace, monospace'
export const openingFont = (px: number) => `700 ${px}px ${OPENING_FONT_FAMILY}`
export const OPENING_JA_FONT_FAMILY = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif'
export const openingJaFont = (px: number) => `700 ${px}px ${OPENING_JA_FONT_FAMILY}`
const MON_FONT = (px: number) => `700 ${px}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif`

export const OPENING_INK = '#F4EFE4'
export const OPENING_JA_INK = 'rgba(244, 239, 228, 0.92)'
const INK_SHADOW = 'rgba(0, 0, 20, 0.7)'

/** The drawing's own size: the video's. Smaller canvases scale their context to it. */
export const OPENING_WIDTH = 1080
export const OPENING_HEIGHT = 1920

/** The English fills at most this share of the width: TikTok cuts off the sides. */
const TEXT_WIDTH_SHARE = 0.8
/** Sizes, as shares of the width. */
const FONT_MAX_SHARE = 0.064
const FONT_MIN_SHARE = 0.044
const JA_SHARE = 0.04
const JA_MIN_SHARE = 0.03
const LINE_STEP = 1.38
/** At most this many lines; past them, the smallest size anyway. */
const MAX_LINES = 4
/** The English block's middle, as a share of the height: above the face, below the feed's top. */
const CENTER_SHARE = 0.4
/** Between the English's last line and the Japanese, as a share of the English size. */
const JA_GAP = 0.9
/** The cursor blinks once every this long once the typing is done (and before it starts). */
const BLINK_S = 1

export interface OpeningLayout {
  fontPx: number
  /** Every character, where it's drawn (left, baseline). */
  chars: { ch: string; x: number; y: number }[]
  /** Where the cursor sits before the first character. */
  cursorStart: { x: number; y: number }
  /** A character's advance, the cursor's width. */
  advance: number
  /** The Japanese: its lines, each drawn from `left` (so it doesn't shift as it's typed), the first at `y`. */
  ja?: { text: string; lines: string[]; fontPx: number; y: number; step: number; lefts: number[] }
  /** 今日のフレーズ: its characters (end exclusive), drawn pink. */
  phrase?: { from: number; to: number }
  /** The phrase's meaning, under the Japanese: its runs, each drawn from `left`. */
  meaning?: { runs: { text: string; left: number; phrase: boolean }[]; fontPx: number; y: number }
}

/** Word-wrapped lines of `text`, each at most `room` wide. */
function wrap(text: string, room: number, width: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && width(next) > room) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

/** The Japanese on one line as big as fits, down to the smallest; past that, two lines split at the middle. */
export function layoutJa(text: string, width: number, measure: (text: string, font: string) => number): { lines: string[]; fontPx: number } {
  const room = width * 0.84
  let fontPx = Math.round(width * JA_SHARE)
  const min = Math.round(width * JA_MIN_SHARE)
  while (fontPx > min && measure(text, openingJaFont(fontPx)) > room) fontPx -= 2
  if (measure(text, openingJaFont(fontPx)) <= room) return { lines: [text], fontPx }
  const chars = [...text]
  const half = Math.ceil(chars.length / 2)
  return { lines: [chars.slice(0, half).join(''), chars.slice(half).join('')], fontPx: Math.round(width * JA_SHARE) }
}

/**
 * The text laid out as typed: wrapped as the whole sentence will be, each
 * line centered as it will end up, so letters appear in place and nothing
 * shifts while it's typed. The Japanese likewise.
 */
export function layoutOpening(
  text: string,
  width: number,
  height: number,
  measure: (text: string, font: string) => number,
  ja?: string,
  phrase?: { phrase: string; phraseJa?: string },
): OpeningLayout {
  const room = width * TEXT_WIDTH_SHARE
  let fontPx = Math.round(width * FONT_MAX_SHARE)
  const minPx = Math.round(width * FONT_MIN_SHARE)
  const linesAt = (px: number) => wrap(text, room, s => measure(s, openingFont(px)))
  let lines = linesAt(fontPx)
  while (fontPx > minPx && (lines.length > 3 || lines.some(l => measure(l, openingFont(fontPx)) > room))) {
    fontPx -= 2
    lines = linesAt(fontPx)
  }
  lines = lines.slice(0, MAX_LINES)
  const font = openingFont(fontPx)
  const step = fontPx * LINE_STEP
  const top = height * CENTER_SHARE - (step * (lines.length - 1)) / 2
  const chars: OpeningLayout['chars'] = []
  // Each source character in order, spaces included, so the typing times line up with them.
  const source = [...text]
  let at = 0
  lines.forEach((line, row) => {
    const y = top + row * step + fontPx * 0.35
    let x = (width - measure(line, font)) / 2
    for (const ch of [...line]) {
      // Whitespace in the source that the wrap folded into the line break.
      while (at < source.length && /\s/.test(source[at]) && ch !== ' ') {
        chars.push({ ch: ' ', x, y })
        at++
      }
      chars.push({ ch, x, y })
      x += measure(ch, font)
      at++
    }
  })
  while (at < source.length) {
    const last = chars[chars.length - 1] ?? { x: width / 2, y: top }
    chars.push({ ch: ' ', x: last.x, y: last.y })
    at++
  }
  const advance = measure('M', font)
  const first = chars[0] ?? { x: width / 2, y: top + fontPx * 0.35 }
  const jaText = ja?.trim()
  let jaLayout: OpeningLayout['ja']
  if (jaText) {
    const { lines: jaLines, fontPx: jaPx } = layoutJa(jaText, width, measure)
    const jaStep = jaPx * 1.4
    jaLayout = {
      text: jaText,
      lines: jaLines,
      fontPx: jaPx,
      y: top + step * (lines.length - 1) + fontPx * (0.35 + JA_GAP) + jaPx * 0.5,
      step: jaStep,
      lefts: jaLines.map(l => (width - measure(l, openingJaFont(jaPx))) / 2),
    }
  }
  const range = phraseRangeOf(text, phrase?.phrase)
  const meaningText = range ? phrase?.phraseJa?.trim() : undefined
  let meaning: OpeningLayout['meaning']
  if (meaningText) {
    const px = Math.round(width * JA_MIN_SHARE)
    const below = jaLayout ? jaLayout.y + jaLayout.step * (jaLayout.lines.length - 1) : top + step * (lines.length - 1) + fontPx * 0.35
    let left = (width - measure(meaningText, openingJaFont(px))) / 2
    const runs = phraseRunsOf(meaningText, phrase?.phrase).map(run => {
      const placed = { ...run, left }
      left += measure(run.text, openingJaFont(px))
      return placed
    })
    meaning = { runs, fontPx: px, y: below + px * 2 }
  }
  return {
    fontPx,
    chars,
    cursorStart: { x: first.x, y: first.y },
    advance,
    ...(jaLayout ? { ja: jaLayout } : {}),
    ...(range ? { phrase: range } : {}),
    ...(meaning ? { meaning } : {}),
  }
}

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
const clamp01 = (p: number) => Math.min(1, Math.max(0, p))

/** How far through the curtain we've walked, 0 (closed) to 1 (gone), `t` seconds into the card. */
export function wipeProgress(timing: Pick<OpeningTiming, 'wipeAt'>, t: number): number {
  return clamp01((t - timing.wipeAt) / OPENING_WIPE_S)
}

/** How many characters are in `t` seconds into the card. */
export function typedCount(timing: Pick<OpeningTiming, 'charTimes'>, t: number): number {
  let n = 0
  while (n < timing.charTimes.length && timing.charTimes[n] <= t + 1e-6) n++
  return n
}

/**
 * How many characters of the Japanese are in `t` seconds into the card:
 * typed alongside the English, over the same span, so it can be read in
 * the time the English takes.
 */
export function jaTypedCount(timing: Pick<OpeningTiming, 'charTimes' | 'typedEnd'>, jaLength: number, t: number): number {
  if (jaLength === 0 || timing.charTimes.length === 0) return 0
  const from = timing.charTimes[0]
  const span = timing.typedEnd - from
  if (t < from - 1e-6) return 0
  if (span <= 0 || jaLength === 1) return jaLength
  return Math.min(jaLength, Math.floor(((t - from) / span) * (jaLength - 1) + 1e-6) + 1)
}

/** Whether the cursor shows: steady while letters are coming, blinking before and after. */
export function cursorShows(timing: OpeningTiming, t: number): boolean {
  if (t >= timing.wipeAt) return false
  const first = timing.charTimes[0] ?? 0
  const typing = t >= first && t < timing.typedEnd + 0.1
  if (typing) return true
  return t % BLINK_S < BLINK_S / 2
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// ---- The 暖簾 ----

/** The rod sits this far down; the cloth hangs from it to below the frame. */
const NOREN_TOP = 70
const NOREN_H = OPENING_HEIGHT - NOREN_TOP + 40
const NOREN_PANELS = 4
/** Where the panels are cut apart, from the cloth's top. */
const NOREN_SLIT = 430
const NOREN_INDIGO = '#1d3559'
const NOREN_WHITE = 'rgba(240, 236, 226, 0.93)'

function seededRandom(seed: number): () => number {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

let cloth: OffscreenCanvas | null = null

/**
 * The cloth, drawn once and kept: indigo with soft folds and a weave, 「話」 in
 * a white ring near the top, and 青海波 waves along the hem. Each frame only
 * cuts it up and moves it.
 */
export function norenCloth(): OffscreenCanvas {
  if (cloth) return cloth
  const c = new OffscreenCanvas(OPENING_WIDTH, NOREN_H)
  const g = c.getContext('2d')
  if (!g) throw new Error('Canvas 2D context unavailable')
  const W = OPENING_WIDTH
  const rnd = seededRandom(3)
  g.fillStyle = NOREN_INDIGO
  g.fillRect(0, 0, W, NOREN_H)
  for (let x = 0; x < W; x++) {
    const b = 0.5 + 0.5 * Math.sin((x / 180) * Math.PI * 2 + 0.7 * Math.sin(x / 233))
    g.fillStyle = `rgba(0,0,0,${(1 - b) * 0.22})`
    g.fillRect(x, 0, 1, NOREN_H)
  }
  for (let i = 0; i < 20000; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'
    g.fillRect(rnd() * W, rnd() * NOREN_H, 2, 2 + rnd() * 5)
  }
  // 「話」 in a ring.
  g.lineWidth = 12
  g.strokeStyle = NOREN_WHITE
  g.beginPath()
  g.arc(W / 2, 250, 120, 0, Math.PI * 2)
  g.stroke()
  g.font = MON_FONT(150)
  g.fillStyle = NOREN_WHITE
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('話', W / 2, 258)
  // 青海波 along the hem: rows of white and indigo half rings.
  const r = 64
  const rows = 7
  const base = NOREN_H - rows * r * 0.5 - 40
  g.save()
  g.beginPath()
  g.rect(0, base - r, W, NOREN_H - base + r)
  g.clip()
  for (let row = 0; row < rows + 2; row++) {
    const y = base + row * r * 0.5
    for (let x = -r; x < W + r; x += r * 2) {
      const cx = x + (row % 2 ? r : 0)
      for (let k = 4; k >= 1; k--) {
        g.beginPath()
        g.arc(cx, y, (r * k) / 4, Math.PI, 0)
        g.fillStyle = k % 2 ? NOREN_INDIGO : NOREN_WHITE
        g.fill()
      }
    }
  }
  g.restore()
  const shade = g.createLinearGradient(0, 0, 0, NOREN_H)
  shade.addColorStop(0, 'rgba(0,0,0,0.3)')
  shade.addColorStop(0.18, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.22)')
  g.fillStyle = shade
  g.fillRect(0, 0, W, NOREN_H)
  cloth = c
  return c
}

/**
 * The 暖簾 `t` seconds into the card. Hanging, the air moves the whole cloth
 * together, so the panels stay edge to edge (only the seams show). Walking
 * through (`walk` 0→1): the middle two panels are pushed apart first, bending
 * like cloth (more the further down), the outer two only nudged; then the
 * cloth comes closer and passes over the top of the frame.
 */
function drawNoren(ctx: Ctx, t: number, walk: number): void {
  const W = OPENING_WIDTH
  const part = easeInOut(clamp01(walk / 0.55))
  const pass = easeInOut(clamp01((walk - 0.18) / 0.82))
  if (pass >= 1) return
  const tex = norenCloth()
  ctx.save()
  const s = 1 + pass * 1.25
  ctx.translate(W / 2, NOREN_TOP)
  ctx.scale(s, s)
  ctx.translate(-W / 2, -NOREN_TOP - pass * (NOREN_H * 0.75))
  const pw = W / NOREN_PANELS
  const strip = 6
  const hang = NOREN_H - NOREN_SLIT
  for (let i = 0; i < NOREN_PANELS; i++) {
    const x = pw * i
    const side = i < NOREN_PANELS / 2 ? -1 : 1
    const reach = i === 1 || i === 2 ? 1 : 0.3
    for (let y = 0; y < hang; y += strip) {
      const v = y / hang
      const bend = Math.pow(v, 1.7)
      const breeze = (Math.sin(t * 1.4 + v * 2.2) * 7 + Math.sin(t * 2.1 + i) * 1.2) * bend * (1 - part)
      const push = side * part * reach * 330 * bend
      const lift = -part * reach * 110 * bend * bend
      const ripple = Math.sin(v * 5 - t * 7 + i) * 9 * part * reach * v
      const turn = 1 - 0.28 * part * reach * bend
      const dx = x + push + breeze + ripple + (side < 0 ? 0 : pw * (1 - turn))
      const dy = NOREN_TOP + NOREN_SLIT + y + lift
      // A hair wider than the panel, so neighbours meet with no light between them.
      ctx.drawImage(tex, x, NOREN_SLIT + y, pw, strip, dx - 0.75, dy, pw * turn + 1.5, strip + 1)
      const shade = 0.32 * part * reach * bend
      if (shade > 0.01) {
        ctx.fillStyle = `rgba(0,0,10,${shade})`
        ctx.fillRect(dx, dy, pw * turn, strip + 1)
      }
      // The seam: a soft shadow where one panel meets the next, its hemmed edge catching light.
      if (i > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.38)'
        ctx.fillRect(dx, dy, 3, strip + 1)
        ctx.fillStyle = 'rgba(255,255,255,0.10)'
        ctx.fillRect(dx + 3, dy, 1.5, strip + 1)
      }
      if (i < NOREN_PANELS - 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)'
        ctx.fillRect(dx + pw * turn - 2, dy, 2, strip + 1)
      }
    }
  }
  ctx.drawImage(tex, 0, 0, W, NOREN_SLIT, 0, NOREN_TOP, W, NOREN_SLIT)
  // Where each slit starts, the stitching that keeps it from tearing.
  for (let i = 1; i < NOREN_PANELS; i++) {
    const x = pw * i
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fillRect(x - 1.5, NOREN_TOP + NOREN_SLIT - 40, 3, 40)
    ctx.fillStyle = 'rgba(240,232,215,0.75)'
    ctx.fillRect(x - 12, NOREN_TOP + NOREN_SLIT - 4, 24, 5)
  }
  const rod = ctx.createLinearGradient(0, NOREN_TOP - 26, 0, NOREN_TOP + 16)
  rod.addColorStop(0, '#9a6b3c')
  rod.addColorStop(1, '#4b2f17')
  ctx.fillStyle = rod
  ctx.fillRect(-40, NOREN_TOP - 26, W + 80, 42)
  ctx.restore()
}

/**
 * The card `t` seconds in, onto `ctx` at the video's size (OPENING_WIDTH ×
 * OPENING_HEIGHT; scale the context for a smaller canvas): `background`
 * (line 1's first frame) behind the 暖簾, the letters typed so far with the
 * cursor and the Japanese typed alongside; then the walk through it.
 */
export function drawOpeningCard(
  ctx: Ctx,
  background: CanvasImageSource | null,
  layout: OpeningLayout,
  timing: OpeningTiming,
  t: number,
): void {
  const W = OPENING_WIDTH
  const H = OPENING_HEIGHT
  ctx.save()
  if (background) ctx.drawImage(background, 0, 0, W, H)
  else {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
  }
  const walk = wipeProgress(timing, t)
  drawNoren(ctx, t, walk)
  // The words are on the cloth: they go as soon as it's pushed.
  const alpha = 1 - clamp01(walk * 3)
  if (alpha > 0) {
    ctx.globalAlpha = alpha
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.font = openingFont(layout.fontPx)
    ctx.fillStyle = OPENING_INK
    ctx.shadowColor = INK_SHADOW
    ctx.shadowBlur = layout.fontPx * 0.15
    ctx.shadowOffsetY = 2
    const shown = typedCount(timing, t)
    const inPhrase = (i: number) => !!layout.phrase && i >= layout.phrase.from && i < layout.phrase.to
    for (let i = 0; i < shown; i++) {
      const c = layout.chars[i]
      ctx.fillStyle = inPhrase(i) ? OPENING_PHRASE_COLOR : OPENING_INK
      if (c && c.ch !== ' ') ctx.fillText(c.ch, c.x, c.y)
    }
    ctx.fillStyle = OPENING_INK
    if (cursorShows(timing, t)) {
      const after = shown > 0 ? layout.chars[shown - 1] : null
      const x = after ? after.x + (after.ch === ' ' ? layout.advance * 0.6 : layout.advance * 1.02) : layout.cursorStart.x
      const y = after ? after.y : layout.cursorStart.y
      ctx.shadowBlur = 0
      ctx.fillRect(x, y - layout.fontPx * 0.78, Math.max(2, layout.fontPx * 0.09), layout.fontPx * 0.95)
    }
    if (layout.ja) {
      const { lines, fontPx, y, step, lefts } = layout.ja
      let left = jaTypedCount(timing, [...layout.ja.text].length, t)
      ctx.font = openingJaFont(fontPx)
      ctx.fillStyle = OPENING_JA_INK
      ctx.shadowBlur = fontPx * 0.2
      lines.forEach((line, row) => {
        const chars = [...line]
        const n = Math.min(chars.length, left)
        left -= n
        if (n > 0) ctx.fillText(chars.slice(0, n).join(''), lefts[row], y + row * step)
      })
    }
    if (layout.meaning && timing.phraseJaAt !== undefined && t >= timing.phraseJaAt) {
      ctx.save()
      ctx.globalAlpha = alpha * Math.min(1, (t - timing.phraseJaAt) / OPENING_PHRASE_JA_FADE_S)
      ctx.font = openingJaFont(layout.meaning.fontPx)
      for (const run of layout.meaning.runs) {
        ctx.fillStyle = run.phrase ? OPENING_PHRASE_COLOR : OPENING_JA_INK
        ctx.fillText(run.text, run.left, layout.meaning.y)
      }
      ctx.restore()
    }
  }
  ctx.restore()
}

/** The card as it stands just before we walk through: both lines typed, the 暖簾 closed. The video's cover. */
export function coverTimeOf(timing: OpeningTiming): number {
  return Math.max(timing.typedEnd + 0.02, timing.wipeAt - 0.01)
}
