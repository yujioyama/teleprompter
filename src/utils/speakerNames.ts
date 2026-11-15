import type { InboxItem } from '../../shared/inbox'
import type { Shot } from '../types'
import { DEFAULT_SPEAKER_ICON } from './speakers'
import { isHeardVoice, type HeardVoice } from './voiceEffects'

/** One of the other people in a conversation, as the script editor lists them: by icon, with their role and voice. */
export interface HeardPerson {
  icon: string
  name: string
  voice: HeardVoice
}

/** The longest role the burn has room for beside the icon. */
export const SPEAKER_NAME_MAX_LENGTH = 32

function addPerson(people: HeardPerson[], icon: string | undefined, name: string | undefined, voice: string | undefined) {
  const key = icon ?? DEFAULT_SPEAKER_ICON
  const found = people.find(p => p.icon === key)
  if (!found) people.push({ icon: key, name: name ?? '', voice: isHeardVoice(voice) ? voice : 'natural' })
  else if (!found.name && name) found.name = name
}

/** The other people of a saved script, in the order they first speak. */
export function heardPeopleOfShots(shots: Shot[]): HeardPerson[] {
  const people: HeardPerson[] = []
  for (const shot of shots) if (shot.heard) addPerson(people, shot.speaker, shot.speakerName, shot.voice)
  return people
}

/** The other people of a script Claude sent, with the roles it sent for them. */
export function heardPeopleOfInbox(item: InboxItem | undefined): HeardPerson[] {
  if (!item?.heard?.length) return []
  const people: HeardPerson[] = []
  const cast = item.heardCast ?? []
  for (const member of cast) addPerson(people, member.icon, member.name, member.voice)
  // Lines in `heard` that no cast member says are the one other person's.
  const inCast = new Set(cast.flatMap(m => m.lines))
  if (item.heard.some(line => !inCast.has(line))) addPerson(people, item.heardIcon, item.heardName, item.heardVoice)
  return people
}

/**
 * `shots` with each 相手のセリフ given its person's role and voice (by icon);
 * a blank role leaves the icon alone. A line whose person isn't listed is kept as it is.
 */
export function withHeardPeople(shots: Shot[], people: HeardPerson[]): Shot[] {
  return shots.map(shot => {
    if (!shot.heard) return shot
    const person = people.find(p => p.icon === (shot.speaker ?? DEFAULT_SPEAKER_ICON))
    if (!person) return shot
    const name = person.name.trim().slice(0, SPEAKER_NAME_MAX_LENGTH)
    const next: Shot = { ...shot }
    delete next.speakerName
    delete next.voice
    return {
      ...next,
      ...(name ? { speakerName: name } : {}),
      ...(person.voice !== 'natural' ? { voice: person.voice } : {}),
    }
  })
}
