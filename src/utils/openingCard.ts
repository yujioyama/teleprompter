import type { ScriptOpening } from '../types'

/**
 * 冒頭カード: before line 1 plays, its first frame holds under a see-through
 * dark curtain while one English sentence is typed out on it, a letter at a
 * time in a typewriter's font with a blinking cursor. Once the English is in,
 * its Japanese fades in small under it (not typed). When the voice is done,
 * the curtain lifts from the bottom up and line 1 starts. The burn, the
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
/** After the last letter, the card waits at least this long (to read the Japanese)… */
export const OPENING_HOLD_S = 0.55
/** …and after the voice ends, at least this long. */
export const OPENING_AFTER_VOICE_S = 0.15
/** The Japanese comes in this long after the last letter, and fades in over OPENING_JA_FADE_S. */
export const OPENING_JA_DELAY_S = 0.05
export const OPENING_JA_FADE_S = 0.4
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

/** The card's timing for `text`, with the recorded voice or without one. */
export function openingTimingOf(text: string, voice?: OpeningVoiceTiming | null): OpeningTiming {
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
  const wipeAt = roundTime(Math.max(typedEnd + OPENING_HOLD_S, voiceAt !== null ? voiceEnd + OPENING_AFTER_VOICE_S : 0))
  const seconds = Math.ceil((wipeAt + OPENING_WIPE_S) * FRAME_RATE - 1e-6) / FRAME_RATE
  return { charTimes, typedEnd, jaAt, voiceAt, wipeAt, seconds }
}

/** What the burn needs to draw the card and play its voice: all plain JSON, so it can sit in the hook. */
export interface OpeningCardPlan {
  text: string
  ja?: string
  timing: OpeningTiming
  /** The prepared voice (see openingVoice.ts), by its key; absent for none. */
  voiceKey?: string
}

export function openingCardPlanOf(opening: ScriptOpening | undefined, voice?: { key: string; timing: OpeningVoiceTiming } | null): OpeningCardPlan | null {
  const text = opening?.text.trim()
  if (!text) return null
  const ja = opening?.ja?.trim()
  return {
    text,
    ...(ja ? { ja } : {}),
    timing: openingTimingOf(text, voice?.timing),
    ...(voice ? { voiceKey: voice.key } : {}),
  }
}

// ---- Drawing ----

/** A typewriter's monospaced font, on every iPhone and Mac; the rest are stand-ins. */
export const OPENING_FONT_FAMILY = '"Courier New", Courier, Menlo, ui-monospace, monospace'
export const openingFont = (px: number) => `700 ${px}px ${OPENING_FONT_FAMILY}`
export const OPENING_JA_FONT_FAMILY = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif'
export const openingJaFont = (px: number) => `600 ${px}px ${OPENING_JA_FONT_FAMILY}`

/** The curtain: dark, with the frame still seen through it. */
export const OPENING_VEIL = 'rgba(6, 6, 10, 0.64)'
export const OPENING_INK = '#F3EFE6'
export const OPENING_JA_INK = 'rgba(243, 239, 230, 0.82)'
/** The curtain's lower edge is soft over this share of the height as it lifts. */
const FEATHER_SHARE = 0.04

/** The English fills at most this share of the width: TikTok cuts off the sides. */
const TEXT_WIDTH_SHARE = 0.8
/** Sizes, as shares of the width. */
const FONT_MAX_SHARE = 0.064
const FONT_MIN_SHARE = 0.044
const JA_SHARE = 0.036
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
  ja?: { text: string; fontPx: number; y: number }
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

/**
 * The text laid out as typed: wrapped as the whole sentence will be, each
 * line centered as it will end up, so letters appear in place and nothing
 * shifts while it's typed.
 */
export function layoutOpening(text: string, width: number, height: number, measure: (text: string, font: string) => number, ja?: string): OpeningLayout {
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
  return {
    fontPx,
    chars,
    cursorStart: { x: first.x, y: first.y },
    advance,
    ...(jaText
      ? { ja: { text: jaText, fontPx: Math.round(width * JA_SHARE), y: top + step * (lines.length - 1) + fontPx * (0.35 + JA_GAP) + width * JA_SHARE * 0.5 } }
      : {}),
  }
}

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
const clamp01 = (p: number) => Math.min(1, Math.max(0, p))

/** How far the curtain has lifted, 0 (down) to 1 (gone), `t` seconds into the card. */
export function wipeProgress(timing: Pick<OpeningTiming, 'wipeAt'>, t: number): number {
  return easeInOut(clamp01((t - timing.wipeAt) / OPENING_WIPE_S))
}

/** How many characters are in `t` seconds into the card. */
export function typedCount(timing: Pick<OpeningTiming, 'charTimes'>, t: number): number {
  let n = 0
  while (n < timing.charTimes.length && timing.charTimes[n] <= t + 1e-6) n++
  return n
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

/**
 * The card `t` seconds in, onto `ctx` (`width` × `height`): `background`
 * (line 1's first frame) under the curtain, the letters typed so far and the
 * cursor, the Japanese once it's in; then the curtain lifting off the frame.
 */
export function drawOpeningCard(
  ctx: Ctx,
  background: CanvasImageSource | null,
  layout: OpeningLayout,
  timing: OpeningTiming,
  t: number,
  width: number,
  height: number,
): void {
  ctx.save()
  if (background) ctx.drawImage(background, 0, 0, width, height)
  else {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
  }
  const lift = wipeProgress(timing, t)
  if (lift >= 1) {
    ctx.restore()
    return
  }
  // The curtain's lower edge, rising from the bottom of the frame to above its top.
  const feather = height * FEATHER_SHARE
  const edge = (height + feather) * (1 - lift)
  ctx.beginPath()
  ctx.rect(0, 0, width, Math.max(0, edge))
  ctx.clip()
  if (lift > 0) {
    const fade = ctx.createLinearGradient(0, edge - feather, 0, edge)
    fade.addColorStop(0, OPENING_VEIL)
    fade.addColorStop(1, 'rgba(6, 6, 10, 0)')
    ctx.fillStyle = OPENING_VEIL
    ctx.fillRect(0, 0, width, Math.max(0, edge - feather))
    ctx.fillStyle = fade
    ctx.fillRect(0, edge - feather, width, feather)
  } else {
    ctx.fillStyle = OPENING_VEIL
    ctx.fillRect(0, 0, width, height)
  }
  // The words go with the curtain, fading as it lifts.
  ctx.globalAlpha = 1 - clamp01(lift * 1.6)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = openingFont(layout.fontPx)
  ctx.fillStyle = OPENING_INK
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = layout.fontPx * 0.12
  const shown = typedCount(timing, t)
  for (let i = 0; i < shown; i++) {
    const c = layout.chars[i]
    if (c && c.ch !== ' ') ctx.fillText(c.ch, c.x, c.y)
  }
  if (cursorShows(timing, t)) {
    const after = shown > 0 ? layout.chars[shown - 1] : null
    const x = after ? after.x + (after.ch === ' ' ? layout.advance * 0.6 : layout.advance * 1.02) : layout.cursorStart.x
    const y = after ? after.y : layout.cursorStart.y
    ctx.shadowBlur = 0
    ctx.fillRect(x, y - layout.fontPx * 0.78, Math.max(2, layout.fontPx * 0.09), layout.fontPx * 0.95)
  }
  if (layout.ja) {
    const p = clamp01((t - timing.jaAt) / OPENING_JA_FADE_S)
    if (p > 0) {
      ctx.globalAlpha *= p
      ctx.font = openingJaFont(layout.ja.fontPx)
      ctx.textAlign = 'center'
      ctx.fillStyle = OPENING_JA_INK
      ctx.shadowBlur = layout.ja.fontPx * 0.15
      ctx.fillText(layout.ja.text, width / 2, layout.ja.y + (1 - easeInOut(p)) * layout.ja.fontPx * 0.4)
    }
  }
  ctx.restore()
}
