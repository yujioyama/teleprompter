import { beforeEach, describe, expect, it } from 'vitest'
import { clearTimings, formatTiming, formatTimings, getTimings, recordEncode, timeStep } from './finalizeTimings'
import { ShotEncodeCache } from './shotEncodeCache'
import { holdEncodes } from './webcodecs/encodeHold'

beforeEach(() => clearTimings())

describe('timeStep', () => {
  it('records the step with its note, and passes the result through', async () => {
    const result = await timeStep('結合: つなぐ', async () => 42, () => 'fast path')
    expect(result).toBe(42)
    const [entry] = getTimings()
    expect(entry).toMatchObject({ type: 'step', label: '結合: つなぐ', note: 'fast path', ok: true })
  })

  it('records a failed step as not ok and rethrows', async () => {
    await expect(timeStep('焼き込み: つなぐ', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(getTimings()[0]).toMatchObject({ ok: false })
  })
})

describe('ShotEncodeCache timings', () => {
  it('records each encode with its kind, shot, length and whether it ran ahead', async () => {
    const cache = new ShotEncodeCache()
    const blob = new Blob(['x'])
    cache.prefetch({ slot: 'normalize:s1', key: 'normalize|s1|1|0.000|2.000', seconds: 2, run: async () => blob })
    await cache.get({ slot: 'burn:s2', key: 'burn|s2|1|0.000|3.000', seconds: 3, run: async () => blob })
    expect(getTimings()).toMatchObject([
      { type: 'encode', kind: 'normalize', shotId: 's1', background: true, seconds: 2, ok: true },
      { type: 'encode', kind: 'burn', shotId: 's2', background: false, seconds: 3, ok: true },
    ])
  })

  it('counts the time the preview held an encode back', async () => {
    const cache = new ShotEncodeCache()
    const release = holdEncodes()
    const encoded = cache.get({
      slot: 'normalize:s1',
      key: 'normalize|s1',
      run: () => new Promise(resolve => setTimeout(() => resolve(new Blob(['x'])), 30)),
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    release()
    await encoded
    const [entry] = getTimings()
    expect(entry.type === 'encode' && entry.heldMs).toBeGreaterThan(0)
  })

  it('says which clips are already made', async () => {
    const cache = new ShotEncodeCache()
    const request = { slot: 'normalize:s1', key: 'k1', run: async () => new Blob(['x']) }
    expect(cache.isDone('k1')).toBe(false)
    await cache.get(request)
    expect(cache.isDone('k1')).toBe(true)
  })
})

describe('formatTimings', () => {
  it('sums the working time apart from the held time, and shows the speed', () => {
    recordEncode({ kind: 'burn', shotId: 's1', background: true, ms: 4000, heldMs: 2000, seconds: 4, ok: true })
    recordEncode({ kind: 'burn', shotId: 's2', background: false, ms: 1000, heldMs: 0, seconds: 2, ok: true })
    const text = formatTimings(getTimings())
    expect(text.split('\n')[0]).toBe(
      'エンコード合計 2本: 実働3.0s (先回り2.0s / 待ち1.0s, プレビューで停止2.0s)',
    )
    expect(formatTiming(getTimings()[0])).toContain('先回り 4.0s うち停止2.0s 長さ4.0s 等速の2.0倍')
  })
})
