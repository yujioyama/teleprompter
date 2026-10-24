import { describe, it, expect } from 'vitest'
import { buildClaudePrompt, parseJapanesePaste, withJapaneseLines, cuesFromShotEntries, cuesForShot, cuesByShot, shotTextsOf, lineStartsInTake, shiftCueStart, takeLinesOf, lineJapaneseOf, withScriptJapanese, type SubtitleCue } from './subtitleCues'

function makeCues(en: string[]): SubtitleCue[] {
  return en.map((text, i) => ({ id: `cue-${i}`, start: i, end: i + 1, en: text, ja: null }))
}

describe('buildClaudePrompt', () => {
  it('numbers cues 1-indexed in order and includes the translation instructions', () => {
    const prompt = buildClaudePrompt(makeCues(['Hello there', 'This is a test']))
    expect(prompt).toContain('1. Hello there')
    expect(prompt).toContain('2. This is a test')
    expect(prompt).toContain('動画に焼き込む日本語字幕')
    expect(prompt).toContain('オネエ全開')
  })

  it('places the numbered lines at the end, under the 【英語セリフ】 heading', () => {
    const prompt = buildClaudePrompt(makeCues(['Hello there', 'This is a test']))
    expect(prompt.endsWith('【英語セリフ】\n1. Hello there\n2. This is a test')).toBe(true)
  })

  it('handles a single cue', () => {
    const prompt = buildClaudePrompt(makeCues(['Only one line']))
    expect(prompt.endsWith('【英語セリフ】\n1. Only one line')).toBe(true)
  })
})

describe('buildClaudePrompt emphasis', () => {
  it('sends the English without its *emphasis* markers', () => {
    const prompt = buildClaudePrompt([{ id: 'c0', start: 0, end: 1, en: 'I *love* it', ja: null }])
    expect(prompt).toContain('1. I love it')
    expect(prompt).not.toContain('*love*')
  })

  it('keeps the {word} marker so the translation marks the same word', () => {
    const prompt = buildClaudePrompt([{ id: 'c0', start: 0, end: 1, en: '*Turmeric*. We call it {ukon}.', ja: null }])
    expect(prompt).toContain('1. Turmeric. We call it {ukon}.')
    expect(prompt).toContain('【{…} で囲まれた語句】')
  })
})

describe('buildClaudePrompt with a request id', () => {
  it('asks Claude to send the lines back to the teleprompter under that id', () => {
    const prompt = buildClaudePrompt(makeCues(['Hello there', 'This is a test']), 'k3x9-2')
    expect(prompt).toContain('【teleprompterへの送信】')
    expect(prompt).toContain('send_subtitles')
    expect(prompt).toContain('request_id: k3x9-2')
    expect(prompt).toContain('（2行）')
    // Sent before the list appears, so the lines are there by the time the user goes back.
    expect(prompt).toContain('まず teleprompter コネクタの send_subtitles')
    expect(prompt.indexOf('send_subtitles')).toBeLessThan(prompt.indexOf('そのあと'))
    // The English still comes last, numbered as before.
    expect(prompt.trimEnd().endsWith('2. This is a test')).toBe(true)
  })

  it('leaves the prompt unchanged without one', () => {
    const cues = makeCues(['Hello there'])
    expect(buildClaudePrompt(cues)).not.toContain('send_subtitles')
    expect(buildClaudePrompt(cues)).toBe(buildClaudePrompt(cues, undefined))
  })
})

describe('withJapaneseLines', () => {
  it('puts each line on the cue in the same position', () => {
    const result = withJapaneseLines(makeCues(['Hello', 'World']), ['こんにちは', '世界'])
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.cues.map(c => c.ja)).toEqual(['こんにちは', '世界'])
  })

  it('refuses a different number of lines', () => {
    const result = withJapaneseLines(makeCues(['Hello', 'World']), ['こんにちは'])
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('行数が一致しません')
  })
})

describe('parseJapanesePaste', () => {
  it('matches numbered lines back onto cues by position', () => {
    const cues = makeCues(['Hello', 'World'])
    const result = parseJapanesePaste('1. こんにちは\n2. 世界', cues)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cues[0].ja).toBe('こんにちは')
      expect(result.cues[1].ja).toBe('世界')
      // English and timing are preserved unchanged
      expect(result.cues[0].en).toBe('Hello')
      expect(result.cues[0].start).toBe(0)
    }
  })

  it('tolerates extra whitespace and blank lines between entries', () => {
    const cues = makeCues(['Hello', 'World'])
    const result = parseJapanesePaste('  1.   こんにちは  \n\n2.世界\n', cues)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cues[0].ja).toBe('こんにちは')
      expect(result.cues[1].ja).toBe('世界')
    }
  })

  it('fails with a listed missing number when a line is absent', () => {
    const cues = makeCues(['Hello', 'World', 'Third'])
    const result = parseJapanesePaste('1. こんにちは\n3. 三番目', cues)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('2')
    }
  })

  it('fails with a listed extra number when an out-of-range line is present', () => {
    const cues = makeCues(['Hello'])
    const result = parseJapanesePaste('1. こんにちは\n2. 余分', cues)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('2')
    }
  })

  it('keeps 。 mid-line and accepts lines with no trailing 。', () => {
    const cues = makeCues(['Hello', 'World', 'Bye'])
    const result = parseJapanesePaste('1. 朝起きた。で、二度寝してた\n2. 暴走族かも\n3. それだけ。', cues)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cues.map(c => c.ja)).toEqual(['朝起きた。で、二度寝してた', '暴走族かも', 'それだけ。'])
    }
  })

  it('ignores non-numbered lines (e.g. a preamble the user forgot to strip)', () => {
    const cues = makeCues(['Hello', 'World'])
    const result = parseJapanesePaste('わかりました！\n1. こんにちは\n2. 世界', cues)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cues[0].ja).toBe('こんにちは')
    }
  })
})

describe('cuesFromShotEntries', () => {
  it('builds one cue per entry, offsetting start/end by cumulative duration', () => {
    const cues = cuesFromShotEntries([
      { text: 'Hello there', duration: 3 },
      { text: 'This is a test', duration: 2 },
    ])
    expect(cues).toEqual([
      { id: 'shot-0', start: 0, end: 3, en: 'Hello there', ja: null },
      { id: 'shot-1', start: 3, end: 5, en: 'This is a test', ja: null },
    ])
  })

  it('skips entries with blank text but still advances the offset', () => {
    const cues = cuesFromShotEntries([
      { text: '   ', duration: 3 },
      { text: 'Second shot', duration: 2 },
    ])
    expect(cues).toEqual([
      { id: 'shot-1', start: 3, end: 5, en: 'Second shot', ja: null },
    ])
  })

  it('trims surrounding whitespace from the shot text', () => {
    const cues = cuesFromShotEntries([{ text: '  padded  ', duration: 1 }])
    expect(cues[0].en).toBe('padded')
  })

  it('returns an empty array for no entries', () => {
    expect(cuesFromShotEntries([])).toEqual([])
  })
})

describe('cuesForShot', () => {
  const cue = (id: string, start: number, end: number): SubtitleCue => ({ id, start, end, en: id, ja: `${id}-ja` })

  it('moves the shot\'s own cue into the shot\'s timeline', () => {
    const cues = cuesFromShotEntries([
      { text: 'one', duration: 1.3 },
      { text: 'two', duration: 2.1 },
      { text: 'three', duration: 0.7 },
    ])
    const [only] = cuesForShot(cues, 1.3, 2.1)
    expect(only.en).toBe('two')
    expect(only.start).toBeCloseTo(0)
    expect(only.end).toBeCloseTo(2.1)
  })

  it('leaves out neighbouring cues that only touch the shot\'s edges', () => {
    const cues = cuesFromShotEntries([
      { text: 'a', duration: 0.1 + 0.2 },
      { text: 'b', duration: 1 },
      { text: 'c', duration: 1 },
    ])
    expect(cuesForShot(cues, 0.1 + 0.2, 1).map(c => c.en)).toEqual(['b'])
  })

  it('clips a cue that spans a shot boundary', () => {
    expect(cuesForShot([cue('x', 0.5, 3)], 1, 1)).toEqual([{ ...cue('x', 0, 1) }])
  })

  it('returns nothing for a shot without a cue', () => {
    expect(cuesForShot([cue('x', 0, 1), cue('y', 2, 3)], 1, 1)).toEqual([])
  })
})

describe('cuesForShot extra fields', () => {
  it('keeps fields beyond the cue itself, such as its style', () => {
    const cues = [{ id: 'a', start: 0, end: 3, en: 'a', ja: 'あ', variant: 'hook' as const }]
    expect(cuesForShot(cues, 2, 2)).toEqual([{ ...cues[0], start: 0, end: 1 }])
  })
})

describe('cuesByShot', () => {
  const cue = (en: string, start: number) => ({ en, start, end: start + 0.5 })

  it('puts each cue in the shot it starts in, in time order', () => {
    const groups = cuesByShot([cue('c', 2.4), cue('a', 0.2), cue('b', 1.9), cue('d', 3)], [2, 1])
    expect(groups.map(g => g.map(c => c.en))).toEqual([['a', 'b'], ['c']])
  })

  it('counts a cue starting exactly at a cut in the next shot, and drops ones past the end', () => {
    expect(cuesByShot([cue('a', 2), cue('b', 5)], [2, 1]).map(g => g.map(c => c.en))).toEqual([[], ['a']])
  })
})

describe('shotTextsOf', () => {
  it('joins each shot\'s English cues, so a shot\'s emoji can be read from its subtitles', () => {
    const cues = [
      { start: 0, end: 1, en: 'I put Vaseline on🧴' },
      { start: 1, end: 2, en: 'my eyebrows' },
      { start: 2.5, end: 4, en: 'It keeps them 💡 neat' },
    ]
    expect(shotTextsOf(cues, [2, 3, 1])).toEqual(['I put Vaseline on🧴 my eyebrows', 'It keeps them 💡 neat', ''])
  })
})

describe('takeLinesOf', () => {
  it('splits a one-take shot into its non-empty lines', () => {
    expect(takeLinesOf(' One. \n\nTwo.\n Three. ')).toEqual(['One.', 'Two.', 'Three.'])
  })
})

describe('lineStartsInTake', () => {
  const lines = ['I used sticky notes.', 'To come back later.', 'I never came back.']
  // Speech filling the whole clip, with these silences inside it.
  const withPauses = (pauses: { start: number; end: number }[]) => ({ speechStart: 0, speechEnd: 100, pauses })

  it('puts each line break at a pause, just before speech resumes', () => {
    // Clip [1, 9]: a short breath at 2.0, line breaks at 3.0–3.6 and 6.0–7.0.
    const pauses = [{ start: 2, end: 2.25 }, { start: 3, end: 3.6 }, { start: 6, end: 7 }]
    const starts = lineStartsInTake(lines, 1, 9, withPauses(pauses))
    expect(starts).toHaveLength(2)
    expect(starts[0]).toBeCloseTo(3.6 - 0.15 - 1, 5)
    expect(starts[1]).toBeCloseTo(7 - 0.15 - 1, 5)
  })

  it('skips a long pause that would leave a line under half a second', () => {
    const pauses = [{ start: 3, end: 4 }, { start: 4.02, end: 4.45 }, { start: 6.6, end: 7 }]
    const starts = lineStartsInTake(lines, 0, 9, withPauses(pauses))
    expect(starts).toHaveLength(2)
    expect(starts[0]).toBeCloseTo(3.85, 5)
    expect(starts[1]).toBeCloseTo(6.85, 5)
  })

  it('passes over a long breath in the middle of a line for the shorter pauses where the lines end', () => {
    const even = ['aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaaaaaaa']
    // Line breaks at 3.0–3.25 and 6.25–6.5; a longer breath mid-line at 4.5–5.0.
    const pauses = [{ start: 3, end: 3.25 }, { start: 4.5, end: 5 }, { start: 6.25, end: 6.5 }]
    const starts = lineStartsInTake(even, 0, 9.6, withPauses(pauses))
    expect(starts[0]).toBeCloseTo(3.125, 5)
    expect(starts[1]).toBeCloseTo(6.375, 5)
  })

  it('keeps the pauses it found when a break has none, placing that one by line length', () => {
    // Speaking time 7.6s shared 1:2:1; the second break has no pause near
    // it, so it goes 5.7s into the speech — 6.1s with the pause.
    const starts = lineStartsInTake(['aa', 'aaaa', 'aa'], 0, 8, withPauses([{ start: 2, end: 2.4 }]))
    expect(starts[0]).toBeCloseTo(2.25, 5)
    expect(starts[1]).toBeCloseTo(6.1, 5)
  })

  it('shares the speaking time out by line length when there are no pauses', () => {
    const starts = lineStartsInTake(['aa', 'aaaa', 'aa'], 0, 8, withPauses([{ start: 4, end: 4.1 }]))
    expect(starts[0]).toBeCloseTo(2, 5)
    expect(starts[1]).toBeCloseTo(6, 5)
    expect(lineStartsInTake(['aa', 'aa'], 0, 4)).toEqual([2])
  })

  it('does not count the silence before the speech as part of the first line', () => {
    const starts = lineStartsInTake(['aa', 'aa'], 0, 10, { speechStart: 2, speechEnd: 10, pauses: [] })
    expect(starts[0]).toBeCloseTo(6, 5)
  })

  it('reads line lengths without the emphasis markers', () => {
    const starts = lineStartsInTake(['{aa}', '*aa*'], 0, 4, withPauses([]))
    expect(starts[0]).toBeCloseTo(2, 5)
  })

  it('has no breaks for a single line', () => {
    expect(lineStartsInTake(['Only line.'], 0, 3, withPauses([{ start: 1, end: 2 }]))).toEqual([])
  })
})

describe('cuesFromShotEntries with line starts', () => {
  it('gives a one-take shot one cue per line, back to back', () => {
    const cues = cuesFromShotEntries([{ text: 'One.\nTwo.\nThree.', duration: 6, lineStarts: [1.5, 4] }])
    expect(cues.map(c => [c.en, c.start, c.end])).toEqual([
      ['One.', 0, 1.5],
      ['Two.', 1.5, 4],
      ['Three.', 4, 6],
    ])
  })

  it('falls back to one cue when the starts do not match the lines', () => {
    const cues = cuesFromShotEntries([{ text: 'One.\nTwo.', duration: 4, lineStarts: [] }])
    expect(cues).toHaveLength(1)
  })
})

describe('shiftCueStart', () => {
  const cues = makeCues(['a', 'b', 'c'])

  it('moves a line start and the previous line end together', () => {
    const moved = shiftCueStart(cues, 'cue-1', 0.2)
    expect(moved[0].end).toBeCloseTo(1.2, 5)
    expect(moved[1].start).toBeCloseTo(1.2, 5)
    expect(moved[2]).toEqual(cues[2])
  })

  it('never squeezes either line below 0.3 seconds, and leaves the first line alone', () => {
    expect(shiftCueStart(cues, 'cue-1', -5)[1].start).toBeCloseTo(0.3, 5)
    expect(shiftCueStart(cues, 'cue-1', 5)[1].start).toBeCloseTo(1.7, 5)
    expect(shiftCueStart(cues, 'cue-0', 0.2)).toBe(cues)
  })
})

describe('lineJapaneseOf', () => {
  it('pairs each non-empty line with its Japanese, in order', () => {
    expect(lineJapaneseOf(' I *love* it.\n\nNobody noticed.🧴 ', ['大好きなの', '誰も気づかなかったのよぉぉぉ'])).toEqual([
      { en: 'I *love* it.', ja: '大好きなの' },
      { en: 'Nobody noticed.🧴', ja: '誰も気づかなかったのよぉぉぉ' },
    ])
  })
})

describe('withScriptJapanese', () => {
  const japanese = [
    { en: 'I *love* it.', ja: '大好きなの' },
    { en: 'Nobody noticed.', ja: '誰も気づかなかったのよぉぉぉ' },
  ]
  const cue = (id: string, en: string): SubtitleCue => ({ id, start: 0, end: 1, en, ja: null })

  it('fills each cue whose English is the line the Japanese was written for', () => {
    const cues = withScriptJapanese([cue('a', 'I *love*  it.'), cue('b', ' Nobody noticed.')], japanese)
    expect(cues.map(c => c.ja)).toEqual(['大好きなの', '誰も気づかなかったのよぉぉぉ'])
  })

  it('leaves a line edited since empty, to fill in', () => {
    const cues = withScriptJapanese([cue('a', 'I *really* love it.'), cue('b', 'Nobody noticed.')], japanese)
    expect(cues.map(c => c.ja)).toEqual(['', '誰も気づかなかったのよぉぉぉ'])
  })

  it('leaves the cues untranslated when no line matches', () => {
    const cues = [cue('a', 'Something else.')]
    expect(withScriptJapanese(cues, japanese)).toBe(cues)
    expect(withScriptJapanese(cues, [])).toBe(cues)
  })
})
