import { stripThemeEmphasis } from './subtitleEmphasis'
import { JAPANESE_SUBTITLE_RULES } from '../../shared/japaneseSubtitles'
import type { LineJapanese } from '../types'

export interface SubtitleCue {
  id: string
  start: number
  end: number
  en: string
  ja: string | null
}

/**
 * With a `requestId` (this device can receive from the connector), Claude is
 * also asked to send the lines back with send_subtitles, so they arrive in
 * the subtitle step without pasting.
 */
export function buildClaudePrompt(cues: SubtitleCue[], requestId?: string): string {
  // The *theme* markers are for the burn-in only, not for translating. The
  // {word} ones stay: the translator marks the same word in Japanese, so
  // it is colored in both lines.
  const lines = cues.map((cue, i) => `${i + 1}. ${stripThemeEmphasis(cue.en)}`).join('\n')
  return `以下は、僕（Yuji）のショート動画の英語セリフです。動画に焼き込む日本語字幕を作ってください。

${JAPANESE_SUBTITLE_RULES}

【出力】
- 「番号. 日本語訳」の形式のみ。番号と行数は英語と完全に一致させる
- 前置きや説明は不要
${requestId ? sendBackSection(requestId, cues.length) : ''}
【英語セリフ】
${lines}`
}

function sendBackSection(requestId: string, lineCount: number): string {
  return `
【teleprompterへの送信】
まず teleprompter コネクタの send_subtitles ツールを呼び出して、翻訳した各行を送ってください。そのあとで、上の【出力】の形式で訳を表示してください。
- request_id: ${requestId}
- lines: 翻訳した各行を番号なしで1行ずつ、英語セリフと同じ順番で（${lineCount}行）
ツールが見つからないときは、【出力】の形式で表示するだけで構いません。
`
}

interface ParseSuccess {
  ok: true
  cues: SubtitleCue[]
}

interface ParseFailure {
  ok: false
  error: string
}

const NUMBERED_LINE = /^\s*(\d+)\.\s*(.+?)\s*$/

export function parseJapanesePaste(text: string, cues: SubtitleCue[]): ParseSuccess | ParseFailure {
  const map = new Map<number, string>()
  for (const rawLine of text.split('\n')) {
    const m = NUMBERED_LINE.exec(rawLine)
    if (!m) continue
    map.set(parseInt(m[1], 10), m[2])
  }

  const missing: number[] = []
  for (let i = 1; i <= cues.length; i++) {
    if (!map.has(i)) missing.push(i)
  }
  const extra = [...map.keys()].filter(n => n < 1 || n > cues.length)

  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = []
    if (missing.length > 0) parts.push(`不足: ${missing.join(', ')}`)
    if (extra.length > 0) parts.push(`余分: ${extra.join(', ')}`)
    return {
      ok: false,
      error: `行数が一致しません（${parts.join(' / ')}）。番号を保ったまま貼り直してください。`,
    }
  }

  return withJapaneseLines(cues, cues.map((_, i) => map.get(i + 1)!))
}

/** Japanese lines onto the cues in the same positions, when the counts match. */
export function withJapaneseLines(cues: SubtitleCue[], lines: string[]): ParseSuccess | ParseFailure {
  if (lines.length !== cues.length) {
    return {
      ok: false,
      error: `行数が一致しません（英語${cues.length}行 / 日本語${lines.length}行）。`,
    }
  }
  return { ok: true, cues: cues.map((cue, i) => ({ ...cue, ja: lines[i] })) }
}

export interface ShotCueInput {
  text: string
  duration: number
  /**
   * 一発撮り: where each line after the first starts, in seconds from the
   * shot's first frame. With one start per line break, the shot is
   * subtitled line by line instead of with one cue.
   */
  lineStarts?: number[]
}

/** Each line of a script Claude sent, with the Japanese it sent for that line. */
export function lineJapaneseOf(body: string, japanese: string[]): LineJapanese[] {
  return takeLinesOf(body).flatMap((en, i) => (japanese[i] ? [{ en, ja: japanese[i] }] : []))
}

function lineKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * The cues with the Japanese Claude sent with the script, on each cue whose
 * English is still the line it was written for. A line edited since (or
 * split differently) gets an empty one to fill in; when no line matches,
 * the cues are left untranslated.
 */
export function withScriptJapanese(cues: SubtitleCue[], japanese: LineJapanese[]): SubtitleCue[] {
  const byEnglish = new Map(japanese.map(line => [lineKey(line.en), line.ja]))
  const found = cues.map(cue => byEnglish.get(lineKey(cue.en)))
  if (found.every(ja => ja === undefined)) return cues
  return cues.map((cue, i) => ({ ...cue, ja: found[i] ?? '' }))
}

/** The lines of a 一発撮り shot's text, one subtitle each. */
export function takeLinesOf(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
}

/** A silence shorter than this is a breath inside a line, not a line break. */
const MIN_LINE_PAUSE_S = 0.12
/** No line is given less than this, however the pauses fall. */
const MIN_LINE_S = 0.5
/** The next line's subtitle shows a moment before its first word. */
const LINE_LEAD_S = 0.15
// How far a line's spoken time may plausibly stray from what its length
// predicts: this share of the prediction, but never less than the floor.
const LINE_TIME_TOLERANCE = 0.35
const MIN_LINE_TIME_TOLERANCE_S = 0.4
// How strongly a pause draws a line break to it, per second of silence, up
// to a cap so one long pause can't outweigh where the lines should fall.
const PAUSE_WEIGHT_PER_S = 6
const MAX_PAUSE_WEIGHT_S = 1

/** Where the speech is in a take (see SpeechRegion). */
export interface TakeSpeech {
  speechStart: number
  speechEnd: number
  pauses?: { start: number; end: number }[]
}

/** A place a line break can go: `at` in the clip, `spoken` seconds of speech before it. */
interface BreakOption {
  at: number
  spoken: number
  /** Seconds of silence there; 0 for a break placed by line length alone. */
  pause: number
}

/**
 * Where each line after the first starts in a 一発撮り take, in seconds from
 * the clip's first frame (the clip being [clipStart, clipEnd] of the take).
 *
 * Each line should take about its share of the speaking time (by its length),
 * and the lines are read with a pause between them. So the breaks are chosen
 * together: each at a pause that keeps every line near its expected time,
 * longer pauses winning more easily — a long breath in the middle of a line
 * still loses to a shorter pause where the line ends. A break with no pause
 * near it goes where the line lengths put it. Either way the subtitle editor
 * can move a break by hand afterwards.
 */
export function lineStartsInTake(
  lines: string[],
  clipStart: number,
  clipEnd: number,
  speech?: TakeSpeech | null,
): number[] {
  const breaks = lines.length - 1
  const duration = clipEnd - clipStart
  if (breaks <= 0 || duration <= 0) return []

  // Only the time spent speaking is shared out between the lines: not the
  // silence around the speech, nor the pauses inside it.
  const inClip = speech && speech.speechStart < clipEnd && speech.speechEnd > clipStart
  const from = inClip ? Math.max(clipStart, speech.speechStart) : clipStart
  const to = inClip ? Math.min(clipEnd, speech.speechEnd) : clipEnd
  const pauses = (speech?.pauses ?? [])
    .filter(p => p.end - p.start >= MIN_LINE_PAUSE_S && p.start > from && p.end < to)
    .sort((a, b) => a.start - b.start)
  const spokenBefore = (t: number) =>
    Math.max(0, Math.min(t, to) - from) -
    pauses.reduce((sum, p) => sum + Math.max(0, Math.min(t, p.end) - p.start), 0)
  const total = spokenBefore(to)
  // The clip time at which `spoken` seconds have been said.
  const timeAtSpoken = (spoken: number) => {
    let t = from + spoken
    for (const p of pauses) if (p.start < t) t += p.end - p.start
    return Math.min(t, to)
  }

  const weights = lines.map(line => Math.max(1, line.replace(/[{}*]/g, '').trim().length))
  const weightTotal = weights.reduce((sum, w) => sum + w, 0)
  const expected = weights.map(w => (w / weightTotal) * total)
  const lineCost = (line: number, spoken: number) => {
    const tolerance = Math.max(MIN_LINE_TIME_TOLERANCE_S, LINE_TIME_TOLERANCE * expected[line])
    return ((spoken - expected[line]) / tolerance) ** 2
  }

  // The next line starts just before speech resumes, never inside the pause's first half.
  const atPauses: BreakOption[] = pauses.map(p => ({
    at: Math.max((p.start + p.end) / 2, p.end - LINE_LEAD_S) - clipStart,
    spoken: spokenBefore(p.start),
    pause: p.end - p.start,
  }))
  let byLength = 0
  const options: BreakOption[][] = expected.slice(0, breaks).map(share => {
    byLength += share
    return [...atPauses, { at: timeAtSpoken(byLength) - clipStart, spoken: byLength, pause: 0 }]
  })

  // Cheapest choice of breaks in order, each line at least MIN_LINE_S long:
  // for each option of the latest break, the cheapest way to reach it.
  type Path = { option: BreakOption; cost: number; path: BreakOption[] }
  const best = options.reduce<Path[]>(
    (previous, choices, k) => choices.map(option => {
      const gain = PAUSE_WEIGHT_PER_S * Math.min(option.pause, MAX_PAUSE_WEIGHT_S)
      let pick = { option, cost: Infinity, path: [] as BreakOption[] }
      for (const prev of previous) {
        if (option.at - prev.option.at < MIN_LINE_S) continue
        const cost = prev.cost + lineCost(k, option.spoken - prev.option.spoken) - gain
        if (cost < pick.cost) pick = { option, cost, path: [...prev.path, option] }
      }
      return pick
    }),
    [{ option: { at: 0, spoken: 0, pause: 0 }, cost: 0, path: [] }],
  )
  let chosen: BreakOption[] | null = null
  let chosenCost = Infinity
  for (const end of best) {
    if (duration - end.option.at < MIN_LINE_S) continue
    const cost = end.cost + lineCost(breaks, total - end.option.spoken)
    if (cost < chosenCost) {
      chosen = end.path
      chosenCost = cost
    }
  }
  if (chosen) return chosen.map(option => option.at)

  // Too short a clip for every line to get MIN_LINE_S: share it by length.
  const starts: number[] = []
  let acc = 0
  for (let i = 0; i < breaks; i++) {
    acc += weights[i]
    starts.push((acc / weightTotal) * duration)
  }
  return starts
}

// Cue timing follows the requested trim durations exactly; it does not
// correct for the few-ms encoder/frame-rounding drift that can accumulate
// across re-encoded clips — imperceptible for sentence-length cues.
export function cuesFromShotEntries(entries: ShotCueInput[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let offset = 0
  entries.forEach((entry, i) => {
    const text = entry.text.trim()
    const lines = entry.lineStarts ? takeLinesOf(text) : []
    if (entry.lineStarts && lines.length > 1 && entry.lineStarts.length === lines.length - 1) {
      const bounds = [0, ...entry.lineStarts, entry.duration]
      lines.forEach((line, j) => {
        cues.push({ id: `shot-${i}-line-${j}`, start: offset + bounds[j], end: offset + bounds[j + 1], en: line, ja: null })
      })
    } else if (text) {
      cues.push({ id: `shot-${i}`, start: offset, end: offset + entry.duration, en: text, ja: null })
    }
    offset += entry.duration
  })
  return cues
}

/**
 * The cues that fall within one shot of the joined video, moved into that
 * shot's own timeline (0 = its first frame) and clipped to its length, for
 * burning subtitles into each shot separately. `shotStart` is where the
 * shot begins in the joined video. Cues touching the shot by less than a
 * rounding error are left out.
 */
export function cuesForShot<T extends SubtitleCue>(cues: T[], shotStart: number, shotDuration: number): T[] {
  const shotEnd = shotStart + shotDuration
  const out: T[] = []
  for (const cue of cues) {
    const start = Math.max(cue.start, shotStart)
    const end = Math.min(cue.end, shotEnd)
    if (end - start <= 1e-6) continue
    out.push({ ...cue, start: start - shotStart, end: end - shotStart })
  }
  return out
}

// A cue starting where a shot ends belongs to the next shot.
const CUT_EPSILON = 1e-6

/**
 * The cues of each shot of the joined video (`durations` in order), a cue
 * counted in the shot it starts in, in time order. Cues starting past the
 * last shot are left out.
 */
export function cuesByShot<T extends { start: number }>(cues: T[], durations: number[]): T[][] {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  let shotStart = 0
  return durations.map(duration => {
    const from = shotStart
    shotStart += duration
    return sorted.filter(c => c.start >= from - CUT_EPSILON && c.start < shotStart - CUT_EPSILON)
  })
}

/** Each shot's English subtitles joined, which is where its fairy's emoji is read from. */
export function shotTextsOf(cues: { start: number; en: string }[], durations: number[]): string[] {
  return cuesByShot(cues, durations).map(group => group.map(c => c.en).join(' '))
}

/** The shortest a line can be squeezed to by moving its neighbours' breaks. */
const MIN_SHIFTED_LINE_S = 0.3

/**
 * Move where cue `id` starts by `delta` seconds, the cue before it ending
 * there too, so the lines stay back to back. Neither line is squeezed
 * below MIN_SHIFTED_LINE_S; the first cue (nothing before it) can't move.
 */
export function shiftCueStart<T extends SubtitleCue>(cues: T[], id: string, delta: number): T[] {
  const i = cues.findIndex(c => c.id === id)
  if (i <= 0) return cues
  const prev = cues[i - 1]
  const cue = cues[i]
  const at = Math.min(Math.max(cue.start + delta, prev.start + MIN_SHIFTED_LINE_S), cue.end - MIN_SHIFTED_LINE_S)
  if (Math.abs(at - cue.start) < 1e-9) return cues
  return cues.map((c, j) => (j === i - 1 ? { ...c, end: at } : j === i ? { ...c, start: at } : c))
}
