import { describe, it, expect } from 'vitest'
import { emphasisRuns, parseEmphasis, reapplyEmphasis, stripEmphasis } from './subtitleEmphasis'

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

describe('reapplyEmphasis', () => {
  const cue = (en: string) => ({ id: en, start: 0, end: 1, en, ja: null })

  it('marks the script\'s phrase on the cue that says it, ignoring case and punctuation', () => {
    const out = reapplyEmphasis([cue('So I said, Carry a torch.')], ['I *carry a torch* for him'])
    expect(out[0].en).toBe('So I said, *Carry a torch*.')
  })

  it('marks each phrase once, at the first place it is said', () => {
    const cues = [cue('really, really sure'), cue('it was really bad')]
    const out = reapplyEmphasis(cues, ['I am *really* sure', 'It was *bad*'])
    expect(out.map(c => c.en)).toEqual(['*really*, really sure', 'it was really *bad*'])
  })

  it('takes the phrases in script order, each after the previous match', () => {
    expect(reapplyEmphasis([cue('a b a')], ['*b*', '*a*'])[0].en).toBe('a *b* *a*')
  })

  it('skips a phrase that was not said, without losing its place', () => {
    const out = reapplyEmphasis([cue('one two three')], ['*missing* and *three*'])
    expect(out[0].en).toBe('one two *three*')
  })

  it('does not match a phrase split across two cues', () => {
    const cues = [cue('carry a'), cue('torch for him')]
    expect(reapplyEmphasis(cues, ['*carry a torch*'])).toEqual(cues)
  })

  it('marks several phrases in one cue', () => {
    expect(reapplyEmphasis([cue("don't stop me now")], ['*Dont* *stop*'])[0].en).toBe("*don't* *stop* me now")
  })

  it('returns the cues as they were when the script has no markers', () => {
    const cues = [cue('hello there')]
    const out = reapplyEmphasis(cues, ['hello there'])
    expect(out).toBe(cues)
  })

  it('leaves a cue without a match as the same object', () => {
    const cues = [cue('alpha'), cue('beta')]
    const out = reapplyEmphasis(cues, ['*beta*'])
    expect(out[0]).toBe(cues[0])
    expect(out[1].en).toBe('*beta*')
  })
})
