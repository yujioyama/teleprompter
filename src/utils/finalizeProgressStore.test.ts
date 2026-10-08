// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearFinalizeProgress,
  combinedForTakes,
  loadFinalizeProgress,
  updateFinalizeProgress,
  type SavedCombined,
  type SavedSubtitles,
} from './finalizeProgressStore'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const COMBINED: SavedCombined = {
  blob: new Blob(['combined'], { type: 'video/mp4' }),
  clips: [
    { shotId: 'shot-a', videoUpdatedAt: 'take-1', start: 0.5, end: 3 },
    { shotId: 'shot-b', videoUpdatedAt: 'take-1', start: 0, end: 4 },
  ],
}

const SUBTITLES: SavedSubtitles = {
  combinedClips: 'shot-a:take-1:0.5:3|shot-b:take-1:0:4',
  cues: [{ id: 'cue-1', start: 0, end: 2.5, en: 'Hello', ja: 'こんにちは' }],
  pasteText: '1. こんにちは',
  position: 70,
  source: 'speech',
}

describe('finalizeProgressStore', () => {
  it('starts empty', async () => {
    expect(await loadFinalizeProgress('script-1')).toEqual({ trims: {}, combined: null, subtitles: null })
  })

  it('keeps the subtitles alongside the 結合', async () => {
    await updateFinalizeProgress('script-1', { combined: COMBINED })
    await updateFinalizeProgress('script-1', { subtitles: SUBTITLES })

    const progress = await loadFinalizeProgress('script-1')
    expect(progress.subtitles).toEqual(SUBTITLES)
    expect(progress.combined!.clips).toEqual(COMBINED.clips)
  })

  it('reads progress saved before subtitles were kept as having none', async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('teleprompter-finalize-progress', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('finalizeProgress', { keyPath: 'scriptId' })
      open.onsuccess = () => {
        const tx = open.result.transaction('finalizeProgress', 'readwrite')
        tx.objectStore('finalizeProgress').put({ scriptId: 'script-1', trims: {}, combined: null })
        tx.oncomplete = () => {
          open.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
    expect((await loadFinalizeProgress('script-1')).subtitles).toBeNull()
  })

  it('keeps the trims and the 結合 saved separately', async () => {
    const trims = { 'shot-a': { videoUpdatedAt: 'take-1', start: 0.5, end: 3 } }
    await updateFinalizeProgress('script-1', { trims })
    await updateFinalizeProgress('script-1', { combined: COMBINED })

    const progress = await loadFinalizeProgress('script-1')
    expect(progress.trims).toEqual(trims)
    expect(progress.combined!.clips).toEqual(COMBINED.clips)
    expect(progress.combined!.blob).toBeInstanceOf(Blob)
  })

  it('keeps each script apart, and clears one', async () => {
    await updateFinalizeProgress('script-1', { combined: COMBINED })
    await updateFinalizeProgress('script-2', { combined: COMBINED })
    await clearFinalizeProgress('script-1')

    expect((await loadFinalizeProgress('script-1')).combined).toBeNull()
    expect((await loadFinalizeProgress('script-2')).combined).not.toBeNull()
  })
})

describe('combinedForTakes', () => {
  it('keeps a 結合 made from exactly these takes', () => {
    expect(combinedForTakes(COMBINED, [['shot-a', 'take-1'], ['shot-b', 'take-1']])).toBe(COMBINED)
  })

  it('drops it after a retake', () => {
    expect(combinedForTakes(COMBINED, [['shot-a', 'take-2'], ['shot-b', 'take-1']])).toBeNull()
  })

  it('drops it once the shots have changed', () => {
    expect(combinedForTakes(COMBINED, [['shot-a', 'take-1']])).toBeNull()
    expect(combinedForTakes(COMBINED, [['shot-b', 'take-1'], ['shot-a', 'take-1']])).toBeNull()
    expect(combinedForTakes(COMBINED, [['shot-a', 'take-1'], ['shot-b', 'take-1'], ['shot-c', 'take-1']])).toBeNull()
  })
})
