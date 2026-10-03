import { describe, it, expect } from 'vitest'
import { buildClaudePrompt, parseJapanesePaste, cuesFromShotEntries, cuesForShot, type SubtitleCue } from './subtitleCues'

function makeCues(en: string[]): SubtitleCue[] {
  return en.map((text, i) => ({ id: `cue-${i}`, start: i, end: i + 1, en: text, ja: null }))
}

describe('buildClaudePrompt', () => {
  it('numbers cues 1-indexed in order and includes the translation instructions', () => {
    const prompt = buildClaudePrompt(makeCues(['Hello there', 'This is a test']))
    expect(prompt).toContain('1. Hello there')
    expect(prompt).toContain('2. This is a test')
    expect(prompt).toContain('動画に焼き込む日本語字幕')
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
