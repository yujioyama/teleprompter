// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearFinalizeProgress,
  combinedForTakes,
  burnedForSubtitles,
  loadFinalizeProgress,
  updateFinalizeProgress,
  type SavedBurn,
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

const BURNED: SavedBurn = {
  blob: new Blob(['burned'], { type: 'video/mp4' }),
  cover: null,
  combinedClips: SUBTITLES.combinedClips,
  inputs: { hook: { style: true, position: 30, punchIn: null }, cues: SUBTITLES.cues, position: 70, durations: [2.5, 4] },
}

describe('finalizeProgressStore', () => {
  it('starts empty', async () => {
    expect(await loadFinalizeProgress('script-1')).toEqual({ trims: {}, combined: null, subtitles: null, burned: null })
  })

  it('keeps the burned video alongside the subtitles it was burned from', async () => {
    await updateFinalizeProgress('script-1', { subtitles: SUBTITLES })
    await updateFinalizeProgress('script-1', { burned: BURNED })

    const progress = await loadFinalizeProgress('script-1')
    expect(progress.subtitles).toEqual(SUBTITLES)
    expect(progress.burned!.blob).toBeInstanceOf(Blob)
    expect(progress.burned!.inputs).toEqual(BURNED.inputs)
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
    expect((await loadFinalizeProgress('script-1')).burned).toBeNull()
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

describe('burnedForSubtitles', () => {
  const { combinedClips, inputs } = BURNED

  it('keeps a burn made from exactly this 結合, these subtitles and this look', () => {
    // As read back from the database: equal, not the same objects.
    const cues = structuredClone(inputs.cues)
    expect(burnedForSubtitles(BURNED, combinedClips, cues, inputs.position, { ...inputs.hook })).toBe(BURNED)
  })

  it('drops it once the video was combined again', () => {
    expect(burnedForSubtitles(BURNED, 'shot-a:take-2:0.5:3', inputs.cues, inputs.position, inputs.hook)).toBeNull()
  })

  it('drops it once a subtitle or the position has changed', () => {
    const edited = [{ ...inputs.cues[0], ja: 'やあ' }]
    expect(burnedForSubtitles(BURNED, combinedClips, edited, inputs.position, inputs.hook)).toBeNull()
    expect(burnedForSubtitles(BURNED, combinedClips, inputs.cues, 20, inputs.hook)).toBeNull()
  })

  it('drops it once the first shot would look different', () => {
    expect(burnedForSubtitles(BURNED, combinedClips, inputs.cues, inputs.position, { ...inputs.hook, style: false })).toBeNull()
  })

  it('has nothing to keep when no burn was saved', () => {
    expect(burnedForSubtitles(null, combinedClips, inputs.cues, inputs.position, inputs.hook)).toBeNull()
  })
})
