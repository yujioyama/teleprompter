import { describe, it, expect } from 'vitest'
import { emphasisRuns, parseEmphasis, stripEmphasis } from './subtitleEmphasis'

describe('parseEmphasis', () => {
  it('removes the markers and flags what they enclosed', () => {
    const e = parseEmphasis('a *big* deal')
    expect(e.text).toBe('a big deal')
    expect(e.emphasized).toEqual([false, false, true, true, true, false, false, false, false, false])
  })

  it('handles several emphasized words', () => {
    const e = parseEmphasis('*one* and *two*')
    expect(e.text).toBe('one and two')
    expect(emphasisRuns([e.text], e)).toEqual([[
      { text: 'one', emphasized: true },
      { text: ' and ', emphasized: false },
      { text: 'two', emphasized: true },
    ]])
  })

  it('leaves an unpaired asterisk as typed', () => {
    const e = parseEmphasis('a 5* rating')
    expect(e.text).toBe('a 5* rating')
    expect(e.emphasized.every(flag => !flag)).toBe(true)
  })

  it('leaves asterisks around spaces as typed, e.g. arithmetic', () => {
    expect(parseEmphasis('5 * 3 * 2').text).toBe('5 * 3 * 2')
  })

  it('does not read ** as an empty emphasis', () => {
    expect(parseEmphasis('a ** b').text).toBe('a ** b')
  })
})

describe('stripEmphasis', () => {
  it('returns the text without its markers', () => {
    expect(stripEmphasis("I still *carry a torch*, don't I?")).toBe("I still carry a torch, don't I?")
  })
})

describe('emphasisRuns', () => {
  it('splits wrapped lines into runs, across the line break', () => {
    const e = parseEmphasis('I still *carry a torch* for him')
    expect(emphasisRuns(['I still carry', 'a torch for him'], e)).toEqual([
      [{ text: 'I still ', emphasized: false }, { text: 'carry', emphasized: true }],
      [{ text: 'a torch', emphasized: true }, { text: ' for him', emphasized: false }],
    ])
  })

  it('follows the text through collapsed whitespace', () => {
    const e = parseEmphasis('  so   *very*\n tired ')
    expect(emphasisRuns(['so very tired'], e)).toEqual([[
      { text: 'so ', emphasized: false },
      { text: 'very', emphasized: true },
      { text: ' tired', emphasized: false },
    ]])
  })

  it('works for Japanese lines, which break without a space', () => {
    const e = parseEmphasis('私は*本気*だったの')
    expect(emphasisRuns(['私は本気', 'だったの'], e)).toEqual([
      [{ text: '私は', emphasized: false }, { text: '本気', emphasized: true }],
      [{ text: 'だったの', emphasized: false }],
    ])
  })

  it('treats a newline, tab or full-width space in the text as the line\'s space', () => {
    const newline = parseEmphasis('so very\ntired *now*')
    expect(emphasisRuns(['so very', 'tired now'], newline)).toEqual([
      [{ text: 'so very', emphasized: false }],
      [{ text: 'tired ', emphasized: false }, { text: 'now', emphasized: true }],
    ])
    const tab = parseEmphasis('a\t*b*c')
    expect(emphasisRuns(['a bc'], tab)).toEqual([[
      { text: 'a ', emphasized: false },
      { text: 'b', emphasized: true },
      { text: 'c', emphasized: false },
    ]])
    const wide = parseEmphasis('私は　*本気*だった')
    expect(emphasisRuns(['私は 本気だった'], wide)).toEqual([[
      { text: '私は ', emphasized: false },
      { text: '本気', emphasized: true },
      { text: 'だった', emphasized: false },
    ]])
  })
})
