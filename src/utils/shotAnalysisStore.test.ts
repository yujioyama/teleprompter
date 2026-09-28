// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import { clearShotAnalyses, listShotAnalyses, updateShotAnalysis } from './shotAnalysisStore'

const REGION = { speechStart: 1, speechEnd: 3, floor: 0, ceiling: 5, duration: 5 }

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('shotAnalysisStore', () => {
  it('merges the duration and the speech found separately for one take', async () => {
    await updateShotAnalysis('script-1', 'shot-a', 'take-1', { duration: 5 })
    await updateShotAnalysis('script-1', 'shot-a', 'take-1', { speech: REGION })

    const analyses = await listShotAnalyses('script-1', new Map([['shot-a', 'take-1']]))
    expect(analyses.get('shot-a')).toEqual({ duration: 5, speech: REGION })
  })

  it('keeps "no speech found" apart from "not checked yet"', async () => {
    await updateShotAnalysis('script-1', 'shot-a', 'take-1', { speech: null })
    await updateShotAnalysis('script-1', 'shot-b', 'take-1', { duration: 4 })

    const analyses = await listShotAnalyses('script-1', new Map([['shot-a', 'take-1'], ['shot-b', 'take-1']]))
    expect(analyses.get('shot-a')!.speech).toBeNull()
    expect(analyses.get('shot-b')!.speech).toBeUndefined()
  })

  it('leaves out the analysis of a take that has since been re-recorded', async () => {
    await updateShotAnalysis('script-1', 'shot-a', 'take-1', { duration: 5, speech: REGION })

    const analyses = await listShotAnalyses('script-1', new Map([['shot-a', 'take-2']]))
    expect(analyses.has('shot-a')).toBe(false)
  })

  it('starts a new take\'s analysis from scratch instead of merging into the old one', async () => {
    await updateShotAnalysis('script-1', 'shot-a', 'take-1', { duration: 5, speech: REGION })
    await updateShotAnalysis('script-1', 'shot-a', 'take-2', { duration: 8 })

    const analyses = await listShotAnalyses('script-1', new Map([['shot-a', 'take-2']]))
    expect(analyses.get('shot-a')).toEqual({ duration: 8, speech: undefined })
  })

  it('clears one script\'s analyses, leaving other scripts untouched', async () => {
    await updateShotAnalysis('script-1', 'shot-a', 'take-1', { duration: 5 })
    await updateShotAnalysis('script-1', 'shot-b', 'take-1', { duration: 6 })
    await updateShotAnalysis('script-2', 'shot-c', 'take-1', { duration: 7 })

    await clearShotAnalyses('script-1')

    expect((await listShotAnalyses('script-1', new Map([['shot-a', 'take-1'], ['shot-b', 'take-1']]))).size).toBe(0)
    expect((await listShotAnalyses('script-2', new Map([['shot-c', 'take-1']]))).size).toBe(1)
  })
})
