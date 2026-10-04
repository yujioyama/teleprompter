import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PreparedAudio, mixForExport, type FinalAudioKey } from './preparedAudio'
import { mixMusic } from './mixMusic'
import { markLoudnessNormalized } from './normalizeLoudness'
import { joinVideoAndAudio, prepareFinalAudio } from './webcodecs/finalAudio'

vi.mock('./mixMusic', () => ({ mixMusic: vi.fn() }))
vi.mock('./normalizeLoudness', () => ({ markLoudnessNormalized: vi.fn() }))
vi.mock('./webcodecs/finalAudio', () => ({ prepareFinalAudio: vi.fn(), joinVideoAndAudio: vi.fn() }))

const COMBINED = new Blob(['combined'], { type: 'video/mp4' })
const BURNED = new Blob(['burned'], { type: 'video/mp4' })
const TRACK = new Blob(['track'], { type: 'audio/mpeg' })
const PREPARED = new Blob(['prepared'], { type: 'audio/mp4' })
const JOINED = new Blob(['joined'], { type: 'video/mp4' })
const MIXED = new Blob(['mixed'], { type: 'video/mp4' })
const KEY: FinalAudioKey = { trackId: 'lofi-tokyo', volume: 0.3, normalize: true }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(prepareFinalAudio).mockResolvedValue(PREPARED)
  vi.mocked(joinVideoAndAudio).mockResolvedValue(JOINED)
  vi.mocked(mixMusic).mockResolvedValue(MIXED)
})

describe('PreparedAudio', () => {
  it('builds the audio once per source and key', async () => {
    const prepared = new PreparedAudio()
    const track = vi.fn(async () => TRACK)
    prepared.prepare(COMBINED, KEY, track)
    prepared.prepare(COMBINED, { ...KEY }, track)
    await expect(prepared.get(COMBINED, KEY)).resolves.toBe(PREPARED)
    expect(prepareFinalAudio).toHaveBeenCalledTimes(1)
    expect(prepareFinalAudio).toHaveBeenCalledWith(COMBINED, TRACK, 0.3, true)
  })

  it('has nothing for another source or key', () => {
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    expect(prepared.get(BURNED, KEY)).toBeNull()
    expect(prepared.get(COMBINED, { ...KEY, volume: 0.5 })).toBeNull()
    expect(prepared.get(COMBINED, { ...KEY, trackId: 'summer-pop' })).toBeNull()
    expect(prepared.get(COMBINED, { ...KEY, normalize: false })).toBeNull()
  })

  it('forgets its result on clear', () => {
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    prepared.clear()
    expect(prepared.get(COMBINED, KEY)).toBeNull()
  })
})

describe('mixForExport', () => {
  it('joins the burned video with the prepared audio, already at the export loudness', async () => {
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    await expect(mixForExport(prepared, COMBINED, BURNED, TRACK, KEY)).resolves.toBe(JOINED)
    expect(joinVideoAndAudio).toHaveBeenCalledWith(BURNED, PREPARED)
    expect(markLoudnessNormalized).toHaveBeenCalledWith(JOINED)
    expect(mixMusic).not.toHaveBeenCalled()
  })

  it('leaves the loudness pass to the export step when the key did not normalize', async () => {
    const key = { ...KEY, normalize: false }
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, key, async () => TRACK)
    await mixForExport(prepared, COMBINED, BURNED, TRACK, key)
    expect(markLoudnessNormalized).not.toHaveBeenCalled()
  })

  it('mixes as before when nothing was prepared for this choice', async () => {
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    const other = { ...KEY, volume: 0.6 }
    await expect(mixForExport(prepared, COMBINED, BURNED, TRACK, other)).resolves.toBe(MIXED)
    expect(mixMusic).toHaveBeenCalledWith(BURNED, TRACK, 0.6)
    expect(joinVideoAndAudio).not.toHaveBeenCalled()
  })

  it('mixes as before when preparing failed', async () => {
    vi.mocked(prepareFinalAudio).mockRejectedValueOnce(new Error('decode failed'))
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    await expect(mixForExport(prepared, COMBINED, BURNED, TRACK, KEY)).resolves.toBe(MIXED)
  })

  it('mixes as before when the join fails', async () => {
    vi.mocked(joinVideoAndAudio).mockRejectedValueOnce(new Error('length mismatch'))
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    await expect(mixForExport(prepared, COMBINED, BURNED, TRACK, KEY)).resolves.toBe(MIXED)
    expect(markLoudnessNormalized).not.toHaveBeenCalled()
  })
})
