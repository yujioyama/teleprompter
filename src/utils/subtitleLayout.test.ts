import { describe, it, expect } from 'vitest'
import {
  EN_STYLE,
  JA_STYLE,
  MeasureText,
  SUBTITLE_FONT_FAMILY,
  SUBTITLE_PADDING_Y,
  SUBTITLE_TEXT_WIDTH,
  fontFor,
  layoutCue,
  outlineWidth,
  tokenize,
  wrapText,
} from './subtitleLayout'

// Deterministic stand-in for canvas measureText: every char is `px` wide for
// CJK and half that otherwise.
const measure: MeasureText = (text, font) => {
  const px = Number(/(\d+)px/.exec(font)![1])
  return Array.from(text).reduce((w, ch) => w + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? px : px / 2), 0)
}
const charWidth = (s: string) => s.length

describe('tokenize', () => {
  it('splits English on whitespace', () => {
    expect(tokenize('In my head,  I had').map(t => t.text)).toEqual(['In', 'my', 'head,', 'I', 'had'])
  })

  it('groups Japanese into phrases with trailing particles and punctuation', () => {
    const phrases = tokenize('絶対もう一人の歌手が通ると思ってたんだ。頭の中では、日本語ではっきり考えてた。').map(t => t.text)
    expect(phrases).toContain('歌手が')
    expect(phrases).toContain('思ってたんだ。')
    expect(phrases).toContain('中では、')
    // No phrase may begin with punctuation that can't start a line.
    for (const p of phrases) expect(p).not.toMatch(/^[、。]/)
  })
})

describe('wrapText', () => {
  it('keeps text that fits on one line', () => {
    expect(wrapText('Hello there', 20, charWidth)).toEqual(['Hello there'])
  })

  it('never produces a line wider than the limit', () => {
    const text = 'I was sure the other singer would go through. In my head, I had a very clear thought.'
    const lines = wrapText(text, 30, charWidth)
    expect(lines.join(' ')).toBe(text)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30)
  })

  it('balances lines instead of leaving a one-word widow', () => {
    // Greedy fill would give ["one two three four five", "six"].
    expect(wrapText('one two three four five six', 23, charWidth)).toEqual(['one two three', 'four five six'])
  })

  it('prefers breaking after sentence punctuation', () => {
    expect(wrapText('It was late. We went home together', 24, charWidth)).toEqual(['It was late.', 'We went home together'])
  })

  it('breaks Japanese between phrases, after the 。', () => {
    const lines = wrapText('絶対もう一人の歌手が通ると思ってたんだ。頭の中では、日本語ではっきり考えてた。', 22, charWidth)
    expect(lines).toEqual(['絶対もう一人の歌手が通ると思ってたんだ。', '頭の中では、日本語ではっきり考えてた。'])
  })

  it('splits a single word wider than the line into pieces that fit', () => {
    const lines = wrapText('abcdefghij', 4, charWidth)
    expect(lines.join('')).toBe('abcdefghij')
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(4)
  })
})

describe('layoutCue', () => {
  it('uses the full font sizes for a short cue', () => {
    const layout = layoutCue({ en: 'Hello there', ja: 'こんにちは' }, measure)
    expect(layout.en).toMatchObject({ fontPx: EN_STYLE.maxPx, lines: ['Hello there'] })
    expect(layout.ja).toMatchObject({ fontPx: JA_STYLE.maxPx, lines: ['こんにちは'] })
  })

  it('wraps a long cue onto several lines that all fit the box', () => {
    const cue = {
      en: 'I was sure the other singer would go through. In my head, I had a very clear thought. In Japanese.',
      ja: '絶対もう一人の歌手が通ると思ってたんだ。頭の中では、日本語ではっきり考えてた。',
    }
    const layout = layoutCue(cue, measure)
    expect(layout.en.lines.length).toBeGreaterThan(1)
    expect(layout.ja!.lines.length).toBeGreaterThan(1)
    expect(layout.en.fontPx).toBeGreaterThanOrEqual(EN_STYLE.minPx)
    for (const line of layout.en.lines) {
      expect(measure(line, fontFor(EN_STYLE, layout.en.fontPx))).toBeLessThanOrEqual(SUBTITLE_TEXT_WIDTH)
    }
    for (const line of layout.ja!.lines) {
      expect(measure(line, fontFor(JA_STYLE, layout.ja!.fontPx))).toBeLessThanOrEqual(SUBTITLE_TEXT_WIDTH)
    }
  })

  it('grows the box height with the number of lines', () => {
    const short = layoutCue({ en: 'Hi', ja: 'やあ' }, measure)
    const long = layoutCue({ en: 'word '.repeat(60), ja: 'やあ' }, measure)
    expect(long.height).toBeGreaterThan(short.height)
  })

  it('omits the Japanese block when there is no translation', () => {
    expect(layoutCue({ en: 'Hi', ja: null }, measure).ja).toBeNull()
  })
})

describe('outlined subtitle geometry', () => {
  it('draws in the system font stack, heavy English and bold Japanese', () => {
    expect(fontFor(EN_STYLE, 60)).toBe(`800 60px ${SUBTITLE_FONT_FAMILY}`)
    expect(fontFor(JA_STYLE, 50)).toBe(`bold 50px ${SUBTITLE_FONT_FAMILY}`)
  })

  it('wraps within 900px and sizes the image to the lines plus room for the outline', () => {
    expect(SUBTITLE_TEXT_WIDTH).toBe(900)
    const layout = layoutCue({ en: 'Hello there', ja: 'こんにちは' }, measure)
    expect(layout.height).toBe(
      SUBTITLE_PADDING_Y * 2 + layout.en.lineHeightPx + 14 + layout.ja!.lineHeightPx,
    )
  })

  it('outlines at 12% of the font size', () => {
    expect(outlineWidth(60)).toBe(7)
    expect(outlineWidth(80)).toBe(10)
  })
})

describe('layoutCue emphasis', () => {
  it('wraps the text without its markers and keeps which words are emphasized', () => {
    const layout = layoutCue({ en: 'I *carry a torch*', ja: '*本気*なの' }, measure)
    expect(layout.en.lines).toEqual(['I carry a torch'])
    expect(layout.en.runs).toEqual([[
      { text: 'I ', emphasized: false },
      { text: 'carry a torch', emphasized: true },
    ]])
    expect(layout.ja!.runs).toEqual([[
      { text: '本気', emphasized: true },
      { text: 'なの', emphasized: false },
    ]])
  })

  it('gives plain text a single plain run per line', () => {
    expect(layoutCue({ en: 'Hello there', ja: null }, measure).en.runs).toEqual([
      [{ text: 'Hello there', emphasized: false }],
    ])
  })
})
