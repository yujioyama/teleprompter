export interface SubtitleCue {
  id: string
  start: number
  end: number
  en: string
  ja: string | null
}

export function buildClaudePrompt(cues: SubtitleCue[]): string {
  const lines = cues.map((cue, i) => `${i + 1}. ${cue.en}`).join('\n')
  return `以下の英語字幕を、自然な話し言葉の日本語字幕に翻訳してください。
- 番号はそのまま保持してください
- 意訳して構いませんが、短く自然な字幕にしてください
- 出力は「番号. 日本語訳」の形式のみとし、前置きや説明は不要です

${lines}`
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

  return {
    ok: true,
    cues: cues.map((cue, i) => ({ ...cue, ja: map.get(i + 1)! })),
  }
}

export interface ShotCueInput {
  text: string
  duration: number
}

// Cue timing follows the requested trim durations exactly; it does not
// correct for the few-ms encoder/frame-rounding drift that can accumulate
// across re-encoded clips — imperceptible for sentence-length cues.
export function cuesFromShotEntries(entries: ShotCueInput[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let offset = 0
  entries.forEach((entry, i) => {
    const text = entry.text.trim()
    if (text) {
      cues.push({ id: `shot-${i}`, start: offset, end: offset + entry.duration, en: text, ja: null })
    }
    offset += entry.duration
  })
  return cues
}
