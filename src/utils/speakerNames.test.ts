import { describe, expect, it } from 'vitest'
import { heardPeopleOfInbox, heardPeopleOfShots, withHeardPeople } from './speakerNames'
import type { InboxItem } from '../../shared/inbox'
import type { Shot } from '../types'

const item = (fields: Partial<InboxItem>): InboxItem => ({ id: 'i', title: 't', body: 'A\nB\nC', caption: '', createdAt: '', ...fields })

describe('heard people', () => {
  it('lists the one other person with the name Claude sent', () => {
    expect(heardPeopleOfInbox(item({ heard: [1], heardIcon: '💇', heardName: 'Hairdresser', heardVoice: 'youngWoman' })))
      .toEqual([{ icon: '💇', name: 'Hairdresser', voice: 'youngWoman' }])
  })

  it('lists each of a cast, with the usual icon for one sent without', () => {
    expect(heardPeopleOfInbox(item({ heard: [1, 3], heardCast: [{ lines: [1], icon: '👩', name: 'Mom', voice: 'olderWoman' }, { lines: [3] }] })))
      .toEqual([{ icon: '👩', name: 'Mom', voice: 'olderWoman' }, { icon: '🗣️', name: '', voice: 'natural' }])
  })

  it('has nobody for a script that is all one voice', () => {
    expect(heardPeopleOfInbox(item({}))).toEqual([])
  })

  it('reads them back off a saved script, once each', () => {
    const shots: Shot[] = [
      { id: '1', text: 'a', heard: true, speaker: '👩', speakerName: 'Mom' },
      { id: '2', text: 'b' },
      { id: '3', text: 'c', heard: true, speaker: '👩' },
    ]
    expect(heardPeopleOfShots(shots)).toEqual([{ icon: '👩', name: 'Mom', voice: 'natural' }])
  })

  it("gives every line of a person their name and voice, and takes a cleared name away", () => {
    const shots: Shot[] = [
      { id: '1', text: 'a', heard: true, speaker: '👩', speakerName: 'Mom', voice: 'high' },
      { id: '2', text: 'b' },
      { id: '3', text: 'c', heard: true, speaker: '👨' },
    ]
    const out = withHeardPeople(shots, [{ icon: '👩', name: '  ', voice: 'olderWoman' }, { icon: '👨', name: ' Boss ', voice: 'natural' }])
    expect(out).toEqual([
      { id: '1', text: 'a', heard: true, speaker: '👩', voice: 'olderWoman' },
      { id: '2', text: 'b' },
      { id: '3', text: 'c', heard: true, speaker: '👨', speakerName: 'Boss' },
    ])
  })
})
