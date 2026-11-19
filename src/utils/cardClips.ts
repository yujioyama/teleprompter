import type { Script } from '../types'
import { DEFAULT_CARD_BACKGROUND } from '../../shared/inbox'
import type { ShotClip } from './shotEncoding'
import { CARD_SECONDS, cardAudioOf, cardBackgroundOf, cardClipId, cardsInOrder, cardTextOf } from './insertCard'
export { cardClipId, isCardClip, cardSpansOf, cardCueInput } from './insertCard'
import { downloadLineImage } from './lineImageDownload'
import { getLineImages } from './lineImageStore'
import { hasWebCodecs } from './webcodecs/support'
import { rawCardClipWebCodecs } from './webcodecs/cardClip'

/** A card's clip, and the shot it comes after. */
export interface CardClip {
  afterShotId: string
  clip: ShotClip
  /** What it looks and sounds like: a saved 結合 with this card in it still holds if this is the same. */
  signature: string
}

// The drawn card by what it looks and sounds like, so a re-combine with the
// same card reuses its blob (and with it the 結合's cached encode).
const made = new Map<string, Promise<Blob>>()

/**
 * The clips of a script's cards, drawn and encoded once each. A card whose
 * background picture can't be got is drawn on the usual background instead; with no
 * WebCodecs, there are no cards (the takes still join as before), and the
 * failure says so.
 */
export async function cardClipsOf(script: Pick<Script, 'cards' | 'cardAudio' | 'oneTake' | 'shots'>, inboxKey?: string): Promise<CardClip[]> {
  const cards = cardsInOrder(script)
  if (cards.length === 0) return []
  if (!(await hasWebCodecs())) throw new Error('この端末ではカードを作れません（WebCodecsが使えません）')
  const { sound } = cardAudioOf(script)
  const clips: CardClip[] = []
  for (const { card } of cards) {
    const text = cardTextOf(card.text)
    const key = JSON.stringify([text, card.background ?? DEFAULT_CARD_BACKGROUND, sound])
    let blob = made.get(key)
    if (!blob) {
      blob = drawCard(text, card.background, sound, inboxKey)
      made.set(key, blob)
      blob.catch(() => made.delete(key))
    }
    clips.push({ afterShotId: card.afterShotId, clip: { shotId: cardClipId(card.id), blob: await blob, start: 0, end: CARD_SECONDS }, signature: `card:${key}` })
  }
  return clips
}

async function drawCard(text: string, backgroundText: string | undefined, sound: boolean, inboxKey?: string): Promise<Blob> {
  let background = cardBackgroundOf(backgroundText)
  let image: ImageBitmap | undefined
  if (background.kind === 'image') {
    try {
      const url = background.url
      let stored = (await getLineImages([url])).get(url)
      if (!stored) {
        await downloadLineImage(url, inboxKey)
        stored = (await getLineImages([url])).get(url)
      }
      if (!stored) throw new Error('image not stored')
      image = await createImageBitmap(stored.blob)
    } catch (err) {
      console.warn('[cardClips] could not get the card background, using the usual one:', err)
      background = { kind: 'named', name: DEFAULT_CARD_BACKGROUND }
    }
  }
  try {
    return await rawCardClipWebCodecs(text, background, image, sound)
  } finally {
    image?.close()
  }
}

/**
 * `clips` with each card's clip right after the clip of the shot it follows.
 * A card after a shot with no take, or after the last clip, is left out: a
 * card sits between two lines.
 */
export function withCardClips<T extends { shotId: string }>(clips: T[], cards: CardClip[], cardItem: (card: CardClip) => T): T[] {
  const out: T[] = []
  clips.forEach((clip, i) => {
    out.push(clip)
    if (i === clips.length - 1) return
    for (const card of cards) if (card.afterShotId === clip.shotId) out.push(cardItem(card))
  })
  return out
}

