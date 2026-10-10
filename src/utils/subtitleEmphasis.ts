/**
 * `*word*` in subtitle text paints that word yellow. The markers are taken
 * out before the text is wrapped, so line breaks are measured on exactly
 * what gets drawn, and only which characters were inside them is kept.
 */

export interface Emphasis {
  /** The text with its `*…*` markers removed. */
  text: string
  /** Whether each UTF-16 unit of `text` was inside a marker pair. */
  emphasized: boolean[]
}

/** A stretch of one line drawn in a single color. */
export interface Run {
  text: string
  emphasized: boolean
}

export const EMPHASIS_COLOR = '#FFD60A'

// A `*…*` pair whose content is non-empty, has no `*` or newline inside, and
// neither starts nor ends with whitespace, so "5 * 3 * 2" or a lone "5*"
// stays as typed. No lookbehind: it throws at load on Safari < 16.4.
const MARKER = /\*([^\s*](?:[^*\n]*[^\s*])?)\*/g

export function parseEmphasis(raw: string): Emphasis {
  let text = ''
  const emphasized: boolean[] = []
  const push = (s: string, flag: boolean) => {
    text += s
    for (let i = 0; i < s.length; i++) emphasized.push(flag)
  }
  const marker = new RegExp(MARKER.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = marker.exec(raw)) !== null) {
    push(raw.slice(last, m.index), false)
    push(m[1], true)
    last = m.index + m[0].length
  }
  push(raw.slice(last), false)
  return { text, emphasized }
}

export function stripEmphasis(raw: string): string {
  return parseEmphasis(raw).text
}

/**
 * Split wrapped lines into plain and emphasized runs. The lines are
 * `emphasis.text` with its whitespace collapsed and broken up (see
 * wrapText). Each space in a line stands for a whole run of whitespace in
 * the text. Walking both side by side, skipping the whitespace that the
 * line doesn't have, finds each drawn character's flag.
 */
export function emphasisRuns(lines: string[], emphasis: Emphasis): Run[][] {
  const { text, emphasized } = emphasis
  let pos = 0
  return lines.map(line => {
    const runs: Run[] = []
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      let flag: boolean
      if (/\s/.test(ch)) {
        // Line space represents a run of whitespace in text
        flag = emphasized[pos] ?? false
        while (pos < text.length && /\s/.test(text[pos])) pos++
      } else {
        // Non-whitespace: skip whitespace in text to get to this char
        while (pos < text.length && /\s/.test(text[pos])) pos++
        flag = emphasized[pos] ?? false
        pos++
      }
      const last = runs[runs.length - 1]
      if (last && last.emphasized === flag) last.text += ch
      else runs.push({ text: ch, emphasized: flag })
    }
    return runs
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

function emphasizedPhrases(scriptTexts: string[]): string[][] {
  const phrases: string[][] = []
  for (const text of scriptTexts) {
    for (const m of text.matchAll(new RegExp(MARKER.source, 'g'))) {
      const words = m[1].split(/\s+/).map(normalizeWord).filter(Boolean)
      if (words.length > 0) phrases.push(words)
    }
  }
  return phrases
}

/**
 * Put the script's `*phrases*` back on cues transcribed from speech. The
 * phrases are taken in script order, and each one marks the first place it
 * is said after the previous match, within a single cue, so the script's
 * emphasis keeps its count and order. A phrase that wasn't said (or was
 * misheard, or is split across two cues) is skipped. Punctuation next to a
 * matched word stays outside the markers.
 */
export function reapplyEmphasis<T extends { en: string }>(cues: T[], scriptTexts: string[]): T[] {
  const phrases = emphasizedPhrases(scriptTexts)
  if (phrases.length === 0) return cues
  const words = cues.map(c => spokenWords(c.en))
  const spans: [number, number][][] = cues.map(() => [])
  let cueAt = 0
  let wordAt = 0
  for (const phrase of phrases) {
    search: for (let c = cueAt; c < cues.length; c++) {
      const list = words[c]
      for (let w = c === cueAt ? wordAt : 0; w + phrase.length <= list.length; w++) {
        if (phrase.every((p, k) => list[w + k].norm === p)) {
          spans[c].push([list[w].start, list[w + phrase.length - 1].end])
          cueAt = c
          wordAt = w + phrase.length
          break search
        }
      }
    }
  }
  return cues.map((cue, i) => {
    if (spans[i].length === 0) return cue
    let en = ''
    let last = 0
    for (const [start, end] of spans[i]) {
      en += `${cue.en.slice(last, start)}*${cue.en.slice(start, end)}*`
      last = end
    }
    return { ...cue, en: en + cue.en.slice(last) }
  })
}
