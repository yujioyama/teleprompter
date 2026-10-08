// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearFinalizeProgress,
  combinedForTakes,
  loadFinalizeProgress,
  updateFinalizeProgress,
  type SavedCombined,
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

describe('finalizeProgressStore', () => {
  it('starts empty', async () => {
    expect(await loadFinalizeProgress('script-1')).toEqual({ trims: {}, combined: null })
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
