import { describe, it, expect } from 'vitest'
import { extractShotId, resolveImportTargets } from './matchShotRecordings'
import { Shot } from '../types'

const SHOT_1 = '11111111-1111-1111-1111-111111111111'
const SHOT_2 = '22222222-2222-2222-2222-222222222222'
const SHOT_3 = '33333333-3333-3333-3333-333333333333'

const shots: Shot[] = [
  { id: SHOT_1, text: 'ショット1' },
  { id: SHOT_2, text: 'ショット2' },
  { id: SHOT_3, text: 'ショット3' },
]

function file(name: string): File {
  return new File(['x'], name, { type: 'video/quicktime' })
}

describe('extractShotId', () => {
  it('extracts the UUID embedded before the extension by teleprompter-cam', () => {
    expect(extractShotId(`TeleprompterCam-abc123-shot1of3-${SHOT_1}.mov`)).toBe(SHOT_1)
  })

  it('returns null for a filename with no embedded UUID', () => {
    expect(extractShotId('IMG_1234.MOV')).toBeNull()
  })

  it('returns null when the trailing segment is not a full UUID', () => {
    expect(extractShotId('TeleprompterCam-abc-shot1of3-not-a-uuid.mov')).toBeNull()
  })
})

describe('resolveImportTargets', () => {
  it('resolves a single matching file as bulk (so a lone retake still auto-saves)', () => {
    const f = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const result = resolveImportTargets([f], shots)
    expect(result).toEqual({ kind: 'bulk', targets: [{ shot: shots[0], file: f }] })
  })

  it('resolves a single non-matching file as legacy', () => {
    const f = file('IMG_1234.MOV')
    const result = resolveImportTargets([f], shots)
    expect(result).toEqual({ kind: 'legacy', file: f })
  })

  it('resolves multiple matching files as bulk, regardless of selection order', () => {
    const f2 = file(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`)
    const f1 = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const result = resolveImportTargets([f2, f1], shots)
    expect(result.kind).toBe('bulk')
    if (result.kind !== 'bulk') throw new Error('expected bulk')
    expect(result.targets).toEqual(
      expect.arrayContaining([
        { shot: shots[0], file: f1 },
        { shot: shots[1], file: f2 },
      ])
    )
    expect(result.targets).toHaveLength(2)
  })

  it('resolves to error when one of several files does not match any shot', () => {
    const f1 = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const bad = file('IMG_9999.MOV')
    const result = resolveImportTargets([f1, bad], shots)
    expect(result).toEqual({ kind: 'error', unmatchedFilenames: ['IMG_9999.MOV'] })
  })

  it('resolves to error when a matched file belongs to a shot id outside this script', () => {
    const foreign = file('TeleprompterCam-abc-shot1of1-99999999-9999-9999-9999-999999999999.mov')
    const known = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const result = resolveImportTargets([known, foreign], shots)
    expect(result).toEqual({ kind: 'error', unmatchedFilenames: [foreign.name] })
  })

  it('lists every unmatched filename when more than one fails to match', () => {
    const bad1 = file('IMG_1.MOV')
    const bad2 = file('IMG_2.MOV')
    const result = resolveImportTargets([bad1, bad2], shots)
    expect(result).toEqual({ kind: 'error', unmatchedFilenames: ['IMG_1.MOV', 'IMG_2.MOV'] })
  })

  it('keeps only the last file when two files in the same batch match the same shot', () => {
    const first = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const retake = file(`TeleprompterCam-xyz-shot1of3-${SHOT_1}.mov`)
    const other = file(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`)
    const result = resolveImportTargets([first, other, retake], shots)
    expect(result.kind).toBe('bulk')
    if (result.kind !== 'bulk') throw new Error('expected bulk')
    expect(result.targets).toHaveLength(2)
    expect(result.targets.find(t => t.shot.id === SHOT_1)?.file).toBe(retake)
  })
})
