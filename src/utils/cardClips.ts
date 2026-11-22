import type { Script } from '../types'
import { DEFAULT_CARD_BACKGROUND } from '../../shared/inbox'
import type { ShotClip } from './shotEncoding'
import { cardAudioOf, cardSecondsFor, cardBackgroundOf, cardClipId, cardsInOrder, cardTextOf, isSpookyCard } from './insertCard'
export { cardClipId, isCardClip, cardSpansOf, cardCueInput } from './insertCard'
import { downloadLineImage } from './lineImageDownload'
import { getLineImages } from './lineImageStore'
import { hasWebCodecs } from './webcodecs/support'
import { rawCardClipWebCodecs } from './webcodecs/cardClip'
import { prepareCardVoice } from './webcodecs/cardVoice'
import { getCardVoice } from './cardVoiceStore'

type CardVoice = { samples: Float32Array; sampleRate: number }

/** In a spooky card's key, so the 結合s saved with a grape card from before it redraw it. */
const SPOOKY_LOOK = 'spooky-1'

/** A card's clip, and the shot it comes after. */
export interface CardClip {
  afterShotId: string
  clip: ShotClip
  /** What it looks and sounds like: a saved 結合 with this card in it still holds if this is the same. */
  signature: string
}

// The drawn card by what it looks and sounds like, so a re-combine with the
// same card reuses its blob (and with it the 結合's cached encode). A card
// with a voice is told apart by when the voice was saved.
const made = new Map<string, Promise<{ blob: Blob; seconds: number; voiced: boolean; voiceFailed: boolean }>>()

/** The cards' clips, and the words of each card whose recorded voice couldn't be read (drawn without it). */
export interface CardClips {
  clips: CardClip[]
  unreadVoices: string[]
}

/**
 * The clips of a script's cards, drawn and encoded once each. A card whose
 * background picture can't be got is drawn on the usual background instead; with no
 * WebCodecs, there are no cards (the takes still join as before), and the
 * failure says so. A card with a voice recorded for it (挿入カードの声) reads
 * it after the pop, and stays up as long as that takes (see cardSecondsFor);
 * a voice with no words in it is left out. A voice that can't be read is left
 * out too, and its card's words are in `unreadVoices` so the page can say so;
 * that card isn't kept, so the next call tries the voice again.
 */
export async function cardClipsOf(script: Pick<Script, 'id' | 'cards' | 'cardAudio' | 'oneTake' | 'shots'>, inboxKey?: string): Promise<CardClips> {
  const cards = cardsInOrder(script)
  if (cards.length === 0) return { clips: [], unreadVoices: [] }
  if (!(await hasWebCodecs())) throw new Error('この端末ではカードを作れません（WebCodecsが使えません）')
  const { sound } = cardAudioOf(script)
  const clips: CardClip[] = []
  const unreadVoices: string[] = []
  for (const { card } of cards) {
    const text = cardTextOf(card.text)
    // Only a card with Japanese has it in its key, so the cards made before keep theirs;
    // likewise only a spooky one has its look (made since 2026-11-22) in it.
    const ja = card.ja ? [card.ja] : []
    const look = isSpookyCard(cardBackgroundOf(card.background)) ? [SPOOKY_LOOK] : []
    const plainKey = JSON.stringify([text, card.background ?? DEFAULT_CARD_BACKGROUND, sound, ...ja, ...look])
    const stored = await getCardVoice(script.id, card.id).catch(err => {
      console.warn('[cardClips] could not read the card voice, drawing the card without it:', err)
      unreadVoices.push(text)
      return null
    })
    const key = stored ? JSON.stringify([text, card.background ?? DEFAULT_CARD_BACKGROUND, sound, ...ja, ...look, stored.savedAt]) : plainKey
    let drawn = made.get(key)
    if (!drawn) {
      drawn = (async () => {
        const { voice, failed } = stored ? await voiceOf(stored.blob) : { voice: undefined, failed: false }
        const seconds = cardSecondsFor(voice ? voice.samples.length / voice.sampleRate : undefined)
        return { blob: await drawCard(text, card.background, sound, voice, inboxKey, card.ja), seconds, voiced: voice !== undefined, voiceFailed: failed }
      })()
      made.set(key, drawn)
      drawn.catch(() => made.delete(key))
    }
    const { blob, seconds, voiced, voiceFailed } = await drawn
    if (voiceFailed) {
      // Not kept: a voice that couldn't be read this time may read the next.
      if (made.get(key) === drawn) made.delete(key)
      unreadVoices.push(text)
    }
    clips.push({ afterShotId: card.afterShotId, clip: { shotId: cardClipId(card.id), blob, start: 0, end: seconds }, signature: `card:${voiced ? key : plainKey}` })
  }
  return { clips, unreadVoices }
}

/**
 * The card's voice as it plays on the card, or none (and why, in the console)
 * when there's none to play; `failed` when it couldn't be read at all.
 */
async function voiceOf(blob: Blob): Promise<{ voice: CardVoice | undefined; failed: boolean }> {
  try {
    const voice = await prepareCardVoice(blob)
    if (voice) return { voice, failed: false }
    console.warn('[cardClips] no words found in the card voice, drawing the card without it')
    return { voice: undefined, failed: false }
  } catch (err) {
    console.warn('[cardClips] could not read the card voice, drawing the card without it:', err)
    return { voice: undefined, failed: true }
  }
}

async function drawCard(text: string, backgroundText: string | undefined, sound: boolean, voice: CardVoice | undefined, inboxKey?: string, ja?: string): Promise<Blob> {
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
    return await rawCardClipWebCodecs(text, background, image, sound, voice, ja)
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

