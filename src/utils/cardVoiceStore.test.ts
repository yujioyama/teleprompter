// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import { saveCardVoice, getCardVoice, pruneCardVoices } from './cardVoiceStore'

const makeBlob = (content: string) => new Blob([content], { type: 'audio/mp4' })

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('cardVoiceStore', () => {
  it('returns null for a card that has no voice', async () => {
    expect(await getCardVoice('script-1', 'card-1')).toBeNull()
  })

  it('round-trips a voice with the time it was saved', async () => {
    await saveCardVoice('script-1', 'card-1', makeBlob('a'))
    const voice = await getCardVoice('script-1', 'card-1')
    expect(await voice!.blob.text()).toBe('a')
    expect(Number.isNaN(Date.parse(voice!.savedAt))).toBe(false)
  })

  it('overwrites the voice on a re-record', async () => {
    await saveCardVoice('script-1', 'card-1', makeBlob('first'))
    await saveCardVoice('script-1', 'card-1', makeBlob('second'))
    expect(await (await getCardVoice('script-1', 'card-1'))!.blob.text()).toBe('second')
  })

  it('pruneCardVoices drops voices whose script or card is gone and keeps the rest', async () => {
    await saveCardVoice('script-1', 'card-a', makeBlob('a'))
    await saveCardVoice('script-1', 'card-gone', makeBlob('x'))
    await saveCardVoice('script-gone', 'card-b', makeBlob('y'))

    await pruneCardVoices([
      { id: 'script-1', cards: [{ id: 'card-a' }] },
      { id: 'script-2' },
    ])

    expect(await getCardVoice('script-1', 'card-a')).not.toBeNull()
    expect(await getCardVoice('script-1', 'card-gone')).toBeNull()
    expect(await getCardVoice('script-gone', 'card-b')).toBeNull()
  })
})
