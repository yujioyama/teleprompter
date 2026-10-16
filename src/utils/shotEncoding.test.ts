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
import type { HookOptions, StyledCue } from './subtitleHook'
import * as burnModule from './burnSubtitles'
import type { SubtitleLook } from './burnSubtitles'
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
// The mid-video zoom has its own tests below; elsewhere it would only add the last shot's punch.
const NO_HOOK: HookOptions = { style: false, position: 50, punchIn: null, midZoom: false }
const HOOK: HookOptions = { style: true, position: 50, punchIn: null, midZoom: false }

function look(position: number, extra: Partial<SubtitleLook> = {}): SubtitleLook {
  return { position, hook: NO_HOOK, firstShotDuration: null, ...extra }
}

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
  const cue: StyledCue = { id: 'shot-0', start: 0, end: 2, en: 'Hi', ja: 'やあ', variant: 'normal' }

  it('is the normalize request when the shot has nothing to burn', () => {
    expect(burnRequest(shot, [], look(50)).key).toBe(normalizeRequest(shot).key)
    expect(burnRequest(shot, [{ ...cue, ja: null }], look(50)).key).toBe(normalizeRequest(shot).key)
  })

  it('changes key with the text or the position, and keeps it otherwise', () => {
    const base = burnRequest(shot, [cue], look(50)).key
    expect(burnRequest(shot, [{ ...cue }], look(50)).key).toBe(base)
    expect(burnRequest(shot, [{ ...cue, ja: 'こんにちは' }], look(50)).key).not.toBe(base)
    expect(burnRequest(shot, [{ ...cue, en: 'Hello' }], look(50)).key).not.toBe(base)
    expect(burnRequest(shot, [cue], look(72)).key).not.toBe(base)
  })

  it('re-encodes when a hook cue\'s Japanese changes, since it is drawn too', () => {
    const hookCue: StyledCue = { ...cue, variant: 'hook' }
    const hookKey = burnRequest(shot, [hookCue], look(50)).key
    expect(burnRequest(shot, [{ ...hookCue, ja: 'まったく別' }], look(50)).key).not.toBe(hookKey)
    expect(burnRequest(shot, [{ ...hookCue, en: 'Hello' }], look(50)).key).not.toBe(hookKey)
  })

  it('changes key with the cue style, and with the hook position only for a hook cue', () => {
    const hookCue: StyledCue = { ...cue, variant: 'hook' }
    const at50 = look(50, { hook: { ...HOOK, position: 50 } })
    const at30 = look(50, { hook: { ...HOOK, position: 30 } })
    expect(burnRequest(shot, [hookCue], at50).key).not.toBe(burnRequest(shot, [cue], at50).key)
    expect(burnRequest(shot, [hookCue], at30).key).not.toBe(burnRequest(shot, [hookCue], at50).key)
    expect(burnRequest(shot, [cue], at30).key).toBe(burnRequest(shot, [cue], at50).key)
  })

  it('changes the first shot\'s key with the punch-in\'s zoom or timing', () => {
    const first = clip('a', 0, 2)
    const at = (punchIn: HookOptions['punchIn']) =>
      burnRequest(first, [], look(50, { hook: { ...HOOK, punchIn }, firstShotDuration: 2 })).key
    const base = { zoom: 1.25 as const, direction: 'in' as const, at: 0.4, duration: null }
    expect(at(null)).toBe(normalizeRequest(first).key)
    expect(at(base)).not.toBe(at(null))
    expect(at({ ...base, zoom: 1.35 })).not.toBe(at(base))
    expect(at({ ...base, at: 0.6 })).not.toBe(at(base))
    expect(at({ ...base, duration: 0.6 })).not.toBe(at(base))
  })

  it('ignores the normal position when every cue in the shot is a hook cue', () => {
    const hookCue: StyledCue = { ...cue, variant: 'hook' }
    const HOOK = { style: true, position: 30, punchIn: null }
    expect(burnRequest(shot, [hookCue], look(50, { hook: HOOK })).key)
      .toBe(burnRequest(shot, [hookCue], look(72, { hook: HOOK })).key)
  })

  it('shares a slot per shot so a newer look replaces the older one', () => {
    expect(burnRequest(shot, [cue], look(50)).slot).toBe(burnRequest(shot, [cue], look(72)).slot)
    expect(burnRequest(shot, [cue], look(50)).slot).not.toBe(normalizeRequest(shot).slot)
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

    await Promise.all(shotBurnRequests(clips, cues, 50, NO_HOOK).map(r => cache.get(r)))

    const calls = vi.mocked(burnModule.burnShotSubtitles).mock.calls
    expect(calls.map(([blob, start, end, shotCues, shotLook]) => [blob, start, end, shotCues, shotLook])).toEqual([
      [clips[0].blob, 1, 3, [expect.objectContaining({ en: 'first', start: 0, end: 2, variant: 'normal' })],
        { position: 50, hook: NO_HOOK, firstShotDuration: 2, fairies: [], midZoom: [] }],
      [clips[1].blob, 0, 1.5, [expect.objectContaining({ en: 'second', start: 0, end: 1.5, variant: 'normal' })],
        { position: 50, hook: NO_HOOK, firstShotDuration: null, fairies: [], midZoom: [] }],
    ])
  })

  it('styles every cue starting in the first shot as a hook cue, the first from its first frame', async () => {
    const clips = [clip('a', 0, 2), clip('b', 0, 2)]
    // Transcribed cues: the first shot split in two, the first starting late,
    // and the second running on into the next shot.
    const cues = translate([
      { id: 'speech-0', start: 0.3, end: 1, en: 'one', ja: null },
      { id: 'speech-1', start: 1.2, end: 2.6, en: 'two', ja: null },
      { id: 'speech-2', start: 2.8, end: 3.8, en: 'three', ja: null },
    ])
    const cache = new ShotEncodeCache()

    await Promise.all(shotBurnRequests(clips, cues, 72, HOOK).map(r => cache.get(r)))

    const [first, second] = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[3])
    expect(first.map(c => [c.en, c.start, c.variant])).toEqual([['one', 0, 'hook'], ['two', 1.2, 'hook']])
    expect(second.map(c => [c.en, c.start, c.variant])).toEqual([
      ['two', 0, 'hook'],
      ['three', expect.closeTo(0.8), 'normal'],
    ])
  })
})

describe('burnSubtitlesByShot', () => {
  const clips = [clip('a', 0, 2), clip('b', 0, 1)]
  const cues = translate(cuesFromShotEntries([
    { text: 'first', duration: 2 },
    { text: 'second', duration: 1 },
  ]))
  const fallbackLook = { position: 50, hook: NO_HOOK, firstShotDuration: 2, fairies: [], midZoom: [] }

  it('joins the per-shot burns by packet copy', async () => {
    const out = await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(2)
    expect(concatClipsWebCodecs).toHaveBeenCalledTimes(1)
    expect(burnModule.burnSubtitles).not.toHaveBeenCalled()
    const burned = await Promise.all(vi.mocked(burnModule.burnShotSubtitles).mock.results.map(r => r.value))
    expect(concatClipsWebCodecs).toHaveBeenCalledWith(burned, undefined)
    expect(out).toBe(await vi.mocked(concatClipsWebCodecs).mock.results[0].value)
  })

  it('only re-burns the shot whose subtitle changed', async () => {
    const cache = new ShotEncodeCache()
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, NO_HOOK)
    const edited = cues.map((c, i) => (i === 1 ? { ...c, ja: '直した' } : c))
    await burnSubtitlesByShot(cache, clips, JOINED, edited, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(3)
    expect(vi.mocked(burnModule.burnShotSubtitles).mock.calls[2][0]).toBe(clips[1].blob)
  })

  it('only re-burns the first shot when the hook style is switched', async () => {
    const cache = new ShotEncodeCache()
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, HOOK)
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(3)
    expect(vi.mocked(burnModule.burnShotSubtitles).mock.calls[2][0]).toBe(clips[0].blob)
  })

  it('reuses the normalized clip for a shot without subtitles', async () => {
    const partial = cues.slice(0, 1)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, partial, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(1)
    expect(trimAndNormalizeShot).toHaveBeenCalledTimes(1)
    expect(vi.mocked(trimAndNormalizeShot).mock.calls[0][0]).toBe(clips[1].blob)
  })

  it('returns the joined video untouched when nothing is translated', async () => {
    const out = await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cuesFromShotEntries([
      { text: 'first', duration: 2 },
    ]), 50, NO_HOOK)
    expect(out).toBe(JOINED)
    expect(burnModule.burnShotSubtitles).not.toHaveBeenCalled()
  })

  it('burns the whole joined video when WebCodecs is unavailable, with the first shot\'s length', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, fallbackLook, undefined, undefined)
  })

  it('disables WebCodecs and burns the whole video when a per-shot burn fails', async () => {
    const err = new Error('encoder died')
    vi.mocked(burnModule.burnShotSubtitles).mockRejectedValueOnce(err)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK)

    expect(disableWebCodecs).toHaveBeenCalledWith(err)
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, fallbackLook, undefined, undefined)
  })

  // Issue #33: the fallback re-encodes the whole video and can take minutes
  // on a phone; without progress the button sat at "0%" the whole time.
  it('reports the whole-video fallback\'s progress', async () => {
    vi.mocked(burnModule.burnShotSubtitles).mockRejectedValueOnce(new Error('encoder died'))
    vi.mocked(burnModule.burnSubtitles).mockImplementation(async (_blob, _cues, _look, onProgress) => {
      onProgress?.(0.37)
      return new Blob(['whole-video-burn'])
    })
    const onProgress = vi.fn()
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK, onProgress)

    expect(onProgress).toHaveBeenLastCalledWith(0.37)
  })

  it('burns the whole video, keeping WebCodecs on, when the burned shots can\'t be packet-joined', async () => {
    vi.mocked(concatClipsWebCodecs).mockRejectedValueOnce(new Error('different parameters'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK)
    warn.mockRestore()

    expect(disableWebCodecs).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, fallbackLook, undefined, undefined)
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
      burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK, undefined, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)

    expect(disableWebCodecs).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).not.toHaveBeenCalled()
  })

  it('burnSubtitlesByShot passes the signal to each shot\'s burn', async () => {
    const controller = new AbortController()
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK, undefined, controller.signal)

    const signals = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[6])
    expect(signals).toHaveLength(2)
    expect(signals.every(s => s instanceof AbortSignal)).toBe(true)
  })
})

describe('first-shot punch-in', () => {
  const EXTRAS: HookOptions = { ...HOOK, punchIn: { zoom: 1.25, direction: 'in', at: 0.4, duration: null } }
  const clips = [clip('a', 0, 2), clip('b', 0, 1)]
  const cues = translate(cuesFromShotEntries([
    { text: 'first', duration: 2 },
    { text: 'second', duration: 1 },
  ]))

  it('goes into the first shot\'s encode only', async () => {
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, EXTRAS)
    const looks = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[4])
    expect(looks.map(l => l.firstShotDuration)).toEqual([2, null])
  })

  it('re-encodes only the first shot when the punch-in changes', async () => {
    const cache = new ShotEncodeCache()
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, EXTRAS)
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, { ...EXTRAS, punchIn: { zoom: 1.35, direction: 'in', at: 0.4, duration: null } })
    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(3)
    expect(vi.mocked(burnModule.burnShotSubtitles).mock.calls[2][0]).toBe(clips[0].blob)
  })

  it('still burns the first shot when it has no translated cue', () => {
    const shot = clip('a', 0, 2)
    const first = look(50, { hook: EXTRAS, firstShotDuration: 2 })
    expect(burnRequest(shot, [], first).key).not.toBe(normalizeRequest(shot).key)
    expect(burnRequest(shot, [], { ...first, firstShotDuration: null }).key).toBe(normalizeRequest(shot).key)
  })
})

describe('fairies', () => {
  const FAIRY_HOOK: HookOptions = { ...HOOK, sticker: 'right', stickerMotion: 'none', fairies: true }
  // Untranslated, so the shots have nothing to burn but their fairies; the emoji are read from these.
  const CUES: SubtitleCue[] = [
    { id: 'a', start: 0.2, end: 1.8, en: 'A 🧴', ja: null },
    { id: 'b', start: 2.3, end: 4.8, en: 'B 💡', ja: null },
    { id: 'c', start: 5.1, end: 7.3, en: 'C', ja: null },
  ]
  const CLIPS = [clip('s1', 0, 2), clip('s2', 0, 3), clip('s3', 0, 2.5)]

  it('burns a shot that only has a fairy, with the fairy in its own timeline', async () => {
    const requests = shotBurnRequests(CLIPS, CUES, 50, FAIRY_HOOK)
    expect(requests[1].key).not.toBe(normalizeRequest(CLIPS[1]).key)
    await encodeAll(new ShotEncodeCache(), requests)
    const looks = new Map(vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => [c[0], c[4]]))
    expect(looks.get(CLIPS[0].blob)?.fairies ?? []).toEqual([])
    const middle = looks.get(CLIPS[1].blob)!.fairies!
    expect(middle.map(f => f.kind)).toEqual(['cameo'])
    expect(middle[0].start).toBeCloseTo(0.3)
    const last = looks.get(CLIPS[2].blob)!.fairies!
    expect(last.map(f => f.kind)).toEqual(['finale'])
    expect(last[0].start).toBeCloseTo(0)
  })

  it("plans the finale clear of the normal subtitles' position, so moving them re-keys only the last shot", () => {
    const at = (position: number) => shotBurnRequests(CLIPS, CUES, position, { ...FAIRY_HOOK, sticker: 'chest' }).map(r => r.key)
    const [a, b] = [at(72.29), at(50)]
    expect(b[1]).toBe(a[1])
    expect(b[2]).not.toBe(a[2])
  })

  it('re-keys a shot when the fairies are turned off', () => {
    const on = shotBurnRequests(CLIPS, CUES, 50, FAIRY_HOOK)[1].key
    const off = shotBurnRequests(CLIPS, CUES, 50, { ...FAIRY_HOOK, fairies: false })[1].key
    expect(off).not.toBe(on)
  })

  it('drops the fairy when its emoji is deleted from the subtitles', async () => {
    const edited = CUES.map(c => (c.id === 'b' ? { ...c, en: 'B' } : c))
    expect(shotBurnRequests(CLIPS, edited, 50, FAIRY_HOOK)[1].key).toBe(normalizeRequest(CLIPS[1]).key)
  })

  it('gives the whole-video fallback the full plan', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    await burnSubtitlesByShot(new ShotEncodeCache(), CLIPS, JOINED, CUES, 50, FAIRY_HOOK)
    const look = vi.mocked(burnModule.burnSubtitles).mock.calls[0][2]
    expect(look.fairies!.map(f => f.kind)).toEqual(['cameo', 'finale'])
  })
})

describe('mid-video zoom', () => {
  // No fairies, so the zoom is all there is to burn.
  const ZOOM_HOOK: HookOptions = { ...HOOK, sticker: 'off', fairies: false, midZoom: true }
  // Untranslated: the shots have nothing to burn but their zoom.
  const CUES: SubtitleCue[] = [
    { id: 'a', start: 0.2, end: 1.8, en: 'A 🧴', ja: null },
    { id: 'b', start: 2.3, end: 4.8, en: 'B 💡', ja: null },
    { id: 'c', start: 5.1, end: 6.8, en: 'C', ja: null },
    { id: 'd', start: 7.2, end: 9.3, en: 'D', ja: null },
  ]
  const CLIPS = [clip('s1', 0, 2), clip('s2', 0, 3), clip('s3', 0, 2), clip('s4', 0, 2.5)]

  it('burns the peak and the punchline in their own timeline, and leaves the other shots normalized', async () => {
    const requests = shotBurnRequests(CLIPS, CUES, 50, ZOOM_HOOK)
    expect(requests[0].key).toBe(normalizeRequest(CLIPS[0]).key)
    expect(requests[2].key).toBe(normalizeRequest(CLIPS[2]).key)
    await encodeAll(new ShotEncodeCache(), requests)
    const looks = new Map(vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => [c[0], c[4]]))
    expect(looks.get(CLIPS[1].blob)?.midZoom).toEqual([{ start: 0, end: 3, kind: 'drift' }])
    expect(looks.get(CLIPS[3].blob)?.midZoom).toEqual([{ start: 0, end: 2.5, kind: 'punch' }])
  })

  it('re-keys only the shot whose peak emoji changes', () => {
    const before = shotBurnRequests(CLIPS, CUES, 50, ZOOM_HOOK).map(r => r.key)
    const edited = CUES.map(c => (c.id === 'c' ? { ...c, en: 'C ✨' } : c))
    const after = shotBurnRequests(CLIPS, edited, 50, ZOOM_HOOK).map(r => r.key)
    expect(after.map((k, i) => k === before[i])).toEqual([true, true, false, true])
  })

  it('does nothing with the setting off', () => {
    const requests = shotBurnRequests(CLIPS, CUES, 50, { ...ZOOM_HOOK, midZoom: false })
    expect(requests.map(r => r.key)).toEqual(CLIPS.map(c => normalizeRequest(c).key))
  })

  it('burns even with nothing translated, and gives the whole-video fallback the full plan', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    const burned = await burnSubtitlesByShot(new ShotEncodeCache(), CLIPS, JOINED, CUES, 50, ZOOM_HOOK)
    expect(burned).not.toBe(JOINED)
    const look = vi.mocked(burnModule.burnSubtitles).mock.calls[0][2]
    expect(look.midZoom).toEqual([
      { start: 2, end: 5, kind: 'drift' },
      { start: 7, end: 9.5, kind: 'punch' },
    ])
  })
})
