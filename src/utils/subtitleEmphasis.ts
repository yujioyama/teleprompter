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
