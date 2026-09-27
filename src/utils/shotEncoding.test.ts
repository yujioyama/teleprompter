import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ShotEncodeCache } from './shotEncodeCache'
import {
  burnRequest,
  burnSubtitlesByShot,
  encodeAll,
  normalizeRequest,
  shotBurnRequests,
  type ShotClip,
} from './shotEncoding'
import { cuesFromShotEntries, type SubtitleCue } from './subtitleCues'
import * as burnModule from './burnSubtitles'
import { canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { concatClipsWebCodecs } from './webcodecs/concatClips'
import { trimAndNormalizeShot } from './trimAndNormalizeShot'
import { CancelledError } from './cancellation'

vi.mock('./burnSubtitles')
vi.mock('./trimAndNormalizeShot', () => ({
  trimAndNormalizeShot: vi.fn(async () => new Blob(['normalized'])),
}))
vi.mock('./webcodecs/support', () => ({
  canUseWebCodecs: vi.fn(async () => true),
  disableWebCodecs: vi.fn(),
}))
vi.mock('./webcodecs/concatClips', () => ({
  concatClipsWebCodecs: vi.fn(async (blobs: Blob[]) => new Blob(blobs)),
}))

const JOINED = new Blob(['joined'])

function clip(shotId: string, start: number, end: number, blob = new Blob([shotId])): ShotClip {
  return { shotId, blob, start, end }
}

function translate(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map(c => ({ ...c, ja: `${c.en}-ja` }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(canUseWebCodecs).mockResolvedValue(true)
  vi.mocked(burnModule.burnShotSubtitles).mockImplementation(async blob => new Blob([blob, '+subs']))
  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['whole-video-burn']))
})

describe('burnRequest', () => {
  const shot = clip('s1', 0.5, 2.5)
  const cue: SubtitleCue = { id: 'shot-0', start: 0, end: 2, en: 'Hi', ja: 'やあ' }

  it('is the normalize request when the shot has nothing to burn', () => {
    expect(burnRequest(shot, [], 50).key).toBe(normalizeRequest(shot).key)
    expect(burnRequest(shot, [{ ...cue, ja: null }], 50).key).toBe(normalizeRequest(shot).key)
  })

  it('changes key with the text or the position, and keeps it otherwise', () => {
    const base = burnRequest(shot, [cue], 50).key
    expect(burnRequest(shot, [{ ...cue }], 50).key).toBe(base)
    expect(burnRequest(shot, [{ ...cue, ja: 'こんにちは' }], 50).key).not.toBe(base)
    expect(burnRequest(shot, [{ ...cue, en: 'Hello' }], 50).key).not.toBe(base)
    expect(burnRequest(shot, [cue], 72).key).not.toBe(base)
  })

  it('shares a slot per shot so a newer look replaces the older one', () => {
    expect(burnRequest(shot, [cue], 50).slot).toBe(burnRequest(shot, [cue], 72).slot)
    expect(burnRequest(shot, [cue], 50).slot).not.toBe(normalizeRequest(shot).slot)
  })
})

describe('shotBurnRequests', () => {
  it('gives each shot its own cue, in the shot\'s timeline', async () => {
    const clips = [clip('a', 1, 3), clip('b', 0, 1.5)]
    const cues = translate(cuesFromShotEntries([
      { text: 'first', duration: 2 },
      { text: 'second', duration: 1.5 },
    ]))
    const cache = new ShotEncodeCache()

    await Promise.all(shotBurnRequests(clips, cues, 50).map(r => cache.get(r)))

    const calls = vi.mocked(burnModule.burnShotSubtitles).mock.calls
    expect(calls.map(([blob, start, end, shotCues, position]) => [blob, start, end, shotCues, position])).toEqual([
      [clips[0].blob, 1, 3, [expect.objectContaining({ en: 'first', start: 0, end: 2 })], 50],
      [clips[1].blob, 0, 1.5, [expect.objectContaining({ en: 'second', start: 0, end: 1.5 })], 50],
    ])
  })
})

describe('burnSubtitlesByShot', () => {
  const clips = [clip('a', 0, 2), clip('b', 0, 1)]
  const cues = translate(cuesFromShotEntries([
    { text: 'first', duration: 2 },
    { text: 'second', duration: 1 },
  ]))

  it('joins the per-shot burns by packet copy', async () => {
    const out = await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(2)
    expect(concatClipsWebCodecs).toHaveBeenCalledTimes(1)
    expect(burnModule.burnSubtitles).not.toHaveBeenCalled()
    const burned = await Promise.all(vi.mocked(burnModule.burnShotSubtitles).mock.results.map(r => r.value))
    expect(concatClipsWebCodecs).toHaveBeenCalledWith(burned, undefined)
    expect(out).toBe(await vi.mocked(concatClipsWebCodecs).mock.results[0].value)
  })

  it('only re-burns the shot whose subtitle changed', async () => {
    const cache = new ShotEncodeCache()
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50)
    const edited = cues.map((c, i) => (i === 1 ? { ...c, ja: '直した' } : c))
    await burnSubtitlesByShot(cache, clips, JOINED, edited, 50)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(3)
    expect(vi.mocked(burnModule.burnShotSubtitles).mock.calls[2][0]).toBe(clips[1].blob)
  })

  it('reuses the normalized clip for a shot without subtitles', async () => {
    const partial = cues.slice(0, 1)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, partial, 50)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(1)
    expect(trimAndNormalizeShot).toHaveBeenCalledTimes(1)
    expect(vi.mocked(trimAndNormalizeShot).mock.calls[0][0]).toBe(clips[1].blob)
  })

  it('returns the joined video untouched when nothing is translated', async () => {
    const out = await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cuesFromShotEntries([
      { text: 'first', duration: 2 },
    ]), 50)
    expect(out).toBe(JOINED)
    expect(burnModule.burnShotSubtitles).not.toHaveBeenCalled()
  })

  it('burns the whole joined video when WebCodecs is unavailable', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50)

    expect(burnModule.burnShotSubtitles).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, 50, undefined, undefined)
  })

  it('disables WebCodecs and burns the whole video when a per-shot burn fails', async () => {
    const err = new Error('encoder died')
    vi.mocked(burnModule.burnShotSubtitles).mockRejectedValueOnce(err)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50)

    expect(disableWebCodecs).toHaveBeenCalledWith(err)
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, 50, undefined, undefined)
  })

  // Issue #33: the fallback re-encodes the whole video and can take minutes
  // on a phone; without progress the button sat at "0%" the whole time.
  it('reports the whole-video fallback\'s progress', async () => {
    vi.mocked(burnModule.burnShotSubtitles).mockRejectedValueOnce(new Error('encoder died'))
    vi.mocked(burnModule.burnSubtitles).mockImplementation(async (_blob, _cues, _position, onProgress) => {
      onProgress?.(0.37)
      return new Blob(['whole-video-burn'])
    })
    const onProgress = vi.fn()
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, onProgress)

    expect(onProgress).toHaveBeenLastCalledWith(0.37)
  })

  it('burns the whole video, keeping WebCodecs on, when the burned shots can\'t be packet-joined', async () => {
    vi.mocked(concatClipsWebCodecs).mockRejectedValueOnce(new Error('different parameters'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50)
    warn.mockRestore()

    expect(disableWebCodecs).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, 50, undefined, undefined)
  })
})

describe('cancelling (issue #34)', () => {
  const clips = [clip('a', 0, 2), clip('b', 0, 1)]
  const cues = translate(cuesFromShotEntries([
    { text: 'first', duration: 2 },
    { text: 'second', duration: 1 },
  ]))

  it('encodeAll cancels the cache, so a hung encode stops blocking it', async () => {
    const cache = new ShotEncodeCache()
    const controller = new AbortController()
    const all = encodeAll(cache, [{ slot: 's1', key: 'k1', run: () => new Promise<Blob>(() => {}) }], undefined, controller.signal)

    controller.abort()

    await expect(all).rejects.toBeInstanceOf(CancelledError)
    await expect(cache.get({ slot: 's2', key: 'k2', run: async () => new Blob(['ok']) })).resolves.toBeInstanceOf(Blob)
  })

  it('encodeAll rejects at once for an already-cancelled signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = vi.fn(async () => new Blob(['x']))

    await expect(encodeAll(new ShotEncodeCache(), [{ slot: 's', key: 'k', run }], undefined, controller.signal))
      .rejects.toBeInstanceOf(CancelledError)
    expect(run).not.toHaveBeenCalled()
  })

  it('burnSubtitlesByShot neither disables WebCodecs nor burns the whole video when cancelled', async () => {
    const controller = new AbortController()
    vi.mocked(burnModule.burnShotSubtitles).mockImplementationOnce(() => {
      controller.abort()
      return new Promise<Blob>(() => {})
    })

    await expect(
      burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, undefined, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)

    expect(disableWebCodecs).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).not.toHaveBeenCalled()
  })

  it('burnSubtitlesByShot passes the signal to each shot\'s burn', async () => {
    const controller = new AbortController()
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, undefined, controller.signal)

    const signals = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[6])
    expect(signals.every(s => s instanceof AbortSignal)).toBe(true)
  })
})
