// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveShotVideo,
  getShotVideo,
  listShotVideos,
  deleteShotVideo,
  clearShotVideos,
} from './shotVideoStore'

function makeBlob(content: string) {
  return new Blob([content], { type: 'video/mp4' })
}

beforeEach(() => {
  // Fresh in-memory IndexedDB for every test so state doesn't leak between them
  globalThis.indexedDB = new IDBFactory()
})

describe('shotVideoStore', () => {
  it('returns null for a shot that was never saved', async () => {
    expect(await getShotVideo('script-1', 'shot-1')).toBeNull()
  })

  it('saves and retrieves a shot video by scriptId + shotId', async () => {
    await saveShotVideo('script-1', 'shot-1', makeBlob('a'))
    const blob = await getShotVideo('script-1', 'shot-1')
    expect(blob).not.toBeNull()
    expect(await blob!.text()).toBe('a')
  })

  it('overwrites the existing entry on a retake (same scriptId + shotId)', async () => {
    await saveShotVideo('script-1', 'shot-1', makeBlob('first-take'))
    await saveShotVideo('script-1', 'shot-1', makeBlob('second-take'))
    const blob = await getShotVideo('script-1', 'shot-1')
    expect(await blob!.text()).toBe('second-take')
  })

  it('lists only the videos belonging to the given script, in no particular order', async () => {
    await saveShotVideo('script-1', 'shot-a', makeBlob('a'))
    await saveShotVideo('script-1', 'shot-b', makeBlob('b'))
    await saveShotVideo('script-2', 'shot-c', makeBlob('c'))

    const list = await listShotVideos('script-1')
    expect(list).toHaveLength(2)
    expect(list.map(v => v.shotId).sort()).toEqual(['shot-a', 'shot-b'])
  })

  it('deletes a single shot video without affecting others', async () => {
    await saveShotVideo('script-1', 'shot-a', makeBlob('a'))
    await saveShotVideo('script-1', 'shot-b', makeBlob('b'))

    await deleteShotVideo('script-1', 'shot-a')

    expect(await getShotVideo('script-1', 'shot-a')).toBeNull()
    expect(await getShotVideo('script-1', 'shot-b')).not.toBeNull()
  })

  it('clears every stored video for a script, leaving other scripts untouched', async () => {
    await saveShotVideo('script-1', 'shot-a', makeBlob('a'))
    await saveShotVideo('script-1', 'shot-b', makeBlob('b'))
    await saveShotVideo('script-2', 'shot-c', makeBlob('c'))

    await clearShotVideos('script-1')

    expect(await listShotVideos('script-1')).toHaveLength(0)
    expect(await listShotVideos('script-2')).toHaveLength(1)
  })
})
