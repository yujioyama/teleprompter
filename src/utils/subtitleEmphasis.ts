/**
 * Two markers color a word in the subtitles:
 * - `*word*` paints the episode's English phrase yellow;
 * - `{word}` paints the Japanese word the episode introduces mint, in the
 *   English line and in its Japanese translation alike.
 * The markers are taken out before the text is wrapped, so line breaks are
 * measured on exactly what gets drawn, and only which characters were inside
 * them (and which kind) is kept.
 */

/** 'theme': `*…*`, the English phrase. 'word': `{…}`, the Japanese word. */
export type EmphasisKind = 'theme' | 'word'

export interface Emphasis {
  /** The text with its markers removed. */
  text: string
  /** Whether each UTF-16 unit of `text` was inside a marker pair of either kind. */
  emphasized: boolean[]
  /** Which marker each UTF-16 unit of `text` was inside, if any. */
  kinds: (EmphasisKind | null)[]
}

/** A stretch of one line drawn in a single color. */
export interface Run {
  text: string
  emphasized: boolean
  /** Set (only) on a `{word}` run, which is drawn in WORD_COLOR. */
  word?: true
}

export const EMPHASIS_COLOR = '#FFD60A'
/** The Japanese word's color: set apart from the yellow theme phrase. */
export const WORD_COLOR = '#5CF2C4'

/** The fill a run is drawn in. */
export function runColor(run: Run): string {
  if (run.word) return WORD_COLOR
  return run.emphasized ? EMPHASIS_COLOR : '#ffffff'
}

// A marker pair whose content is non-empty, has no marker character or
// newline inside, and neither starts nor ends with whitespace, so "5 * 3 * 2"
// or a lone "5*" stays as typed. Group 1 is a `*…*`, group 2 a `{…}`. No
// lookbehind: it throws at load on Safari < 16.4.
const STAR = String.raw`\*([^\s*](?:[^*\n]*[^\s*])?)\*`
const BRACE = String.raw`\{([^\s{}](?:[^{}\n]*[^\s{}])?)\}`
const MARKER = new RegExp(`${STAR}|${BRACE}`, 'g')
const STAR_ONLY = new RegExp(STAR, 'g')

export function parseEmphasis(raw: string): Emphasis {
  let text = ''
  const emphasized: boolean[] = []
  const kinds: (EmphasisKind | null)[] = []
  const push = (s: string, kind: EmphasisKind | null) => {
    text += s
    for (let i = 0; i < s.length; i++) {
      emphasized.push(kind !== null)
      kinds.push(kind)
    }
  }
  const marker = new RegExp(MARKER.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = marker.exec(raw)) !== null) {
    push(raw.slice(last, m.index), null)
    if (m[1] !== undefined) push(m[1], 'theme')
    else push(m[2], 'word')
    last = m.index + m[0].length
  }
  push(raw.slice(last), null)
  return { text, emphasized, kinds }
}

/** The text without any markers, as it is read aloud or shown in lists. */
export function stripEmphasis(raw: string): string {
  return parseEmphasis(raw).text
}

/**
 * The text without its `*…*` markers but with its `{…}` ones, for the
 * translation prompt: the translator marks the same Japanese word in
 * the translation, so it is colored there too.
 */
export function stripThemeEmphasis(raw: string): string {
  return raw.replace(new RegExp(STAR_ONLY.source, 'g'), '$1')
}

/**
 * Split wrapped lines into plain and emphasized runs. The lines are
 * `emphasis.text` with its whitespace collapsed and broken up (see
 * wrapText). Each space in a line stands for a whole run of whitespace in
 * the text. Walking both side by side, skipping the whitespace that the
 * line doesn't have, finds each drawn character's kind.
 */
export function emphasisRuns(lines: string[], emphasis: Emphasis): Run[][] {
  const { text, kinds } = emphasis
  let pos = 0
  return lines.map(line => {
    const runs: { text: string; kind: EmphasisKind | null }[] = []
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      let kind: EmphasisKind | null
      if (/\s/.test(ch)) {
        // Line space represents a run of whitespace in text
        kind = kinds[pos] ?? null
        while (pos < text.length && /\s/.test(text[pos])) pos++
      } else {
        // Non-whitespace: skip whitespace in text to get to this char
        while (pos < text.length && /\s/.test(text[pos])) pos++
        kind = kinds[pos] ?? null
        pos++
      }
      const last = runs[runs.length - 1]
      if (last && last.kind === kind) last.text += ch
      else runs.push({ text: ch, kind })
    }
    return runs.map(({ text, kind }): Run =>
      kind === 'word' ? { text, emphasized: true, word: true } : { text, emphasized: kind !== null },
    )
  })
}

// Words compare without case, width or punctuation: "Don't," matches "dont".
const normalizeWord = (word: string) => word.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

interface SpokenWord {
  norm: string
  /** Where the word sits in the cue's text, without punctuation around it. */
  start: number
  end: number
}

function spokenWords(text: string): SpokenWord[] {
  const words: SpokenWord[] = []
  for (const m of text.matchAll(/\S+/g)) {
    const raw = m[0]
    const norm = normalizeWord(raw)
    if (!norm) continue
    const lead = /^[^\p{L}\p{N}]*/u.exec(raw)![0].length
    const trail = /[^\p{L}\p{N}]*$/u.exec(raw)![0].length
    words.push({ norm, start: m.index! + lead, end: m.index! + raw.length - trail })
  }
  return words
}

interface Phrase {
  words: string[]
  kind: EmphasisKind
}

function emphasizedPhrases(scriptTexts: string[]): Phrase[] {
  const phrases: Phrase[] = []
  for (const text of scriptTexts) {
    for (const m of text.matchAll(new RegExp(MARKER.source, 'g'))) {
      const kind: EmphasisKind = m[1] !== undefined ? 'theme' : 'word'
      const words = (m[1] ?? m[2]).split(/\s+/).map(normalizeWord).filter(Boolean)
      if (words.length > 0) phrases.push({ words, kind })
    }
  }
  return phrases
}

const OPEN: Record<EmphasisKind, string> = { theme: '*', word: '{' }
const CLOSE: Record<EmphasisKind, string> = { theme: '*', word: '}' }

/**
 * Put the script's `*phrases*` and `{words}` back on cues transcribed from
 * speech. The phrases are taken in script order, and each one marks the
 * first place it is said after the previous match, within a single cue, so
 * the script's emphasis keeps its count and order. A phrase that wasn't said
 * (or was misheard, or is split across two cues) is skipped. Punctuation
 * next to a matched word stays outside the markers.
 */
export function reapplyEmphasis<T extends { en: string }>(cues: T[], scriptTexts: string[]): T[] {
  const phrases = emphasizedPhrases(scriptTexts)
  if (phrases.length === 0) return cues
  const words = cues.map(c => spokenWords(c.en))
  const spans: [number, number, EmphasisKind][][] = cues.map(() => [])
  let cueAt = 0
  let wordAt = 0
  for (const phrase of phrases) {
    search: for (let c = cueAt; c < cues.length; c++) {
      const list = words[c]
      for (let w = c === cueAt ? wordAt : 0; w + phrase.words.length <= list.length; w++) {
        if (phrase.words.every((p, k) => list[w + k].norm === p)) {
          spans[c].push([list[w].start, list[w + phrase.words.length - 1].end, phrase.kind])
          cueAt = c
          wordAt = w + phrase.words.length
          break search
        }
      }
    }
  }
  return cues.map((cue, i) => {
    if (spans[i].length === 0) return cue
    let en = ''
    let last = 0
    for (const [start, end, kind] of spans[i]) {
      en += `${cue.en.slice(last, start)}${OPEN[kind]}${cue.en.slice(start, end)}${CLOSE[kind]}`
      last = end
    }
    return { ...cue, en: en + cue.en.slice(last) }
  })
}
