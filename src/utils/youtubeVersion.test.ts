import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mixYoutubeVersion, type YoutubeBgmSwap } from './youtubeVersion'
import { MUSIC_TRACKS } from '../data/musicTracks'
import { fetchTrack } from './fetchTrack'
import { mixMusic } from './mixMusic'
import { finishAudio, markLoudnessNormalized } from './normalizeLoudness'
import { joinVideoAndAudio, prepareFinalAudio } from './webcodecs/finalAudio'
import { canUseWebCodecs } from './webcodecs/support'

vi.mock('./fetchTrack', () => ({ fetchTrack: vi.fn() }))
vi.mock('./mixMusic', () => ({ mixMusic: vi.fn() }))
vi.mock('./normalizeLoudness', () => ({ finishAudio: vi.fn(), markLoudnessNormalized: vi.fn() }))
vi.mock('./webcodecs/finalAudio', () => ({ prepareFinalAudio: vi.fn(), joinVideoAndAudio: vi.fn() }))
vi.mock('./webcodecs/support', () => ({ canUseWebCodecs: vi.fn() }))

const TRACK = MUSIC_TRACKS.find(t => t.id === 'youtube-touching-moment')!
const TRACK_BLOB = new Blob(['touching-moment'], { type: 'audio/mpeg' })
const PREPARED = new Blob(['prepared'], { type: 'audio/mp4' })
const JOINED = new Blob(['joined'], { type: 'video/mp4' })
const MIXED = new Blob(['mixed'], { type: 'video/mp4' })
const FINISHED = new Blob(['finished'], { type: 'video/mp4' })

function swapOf(overrides: Partial<YoutubeBgmSwap> = {}): YoutubeBgmSwap {
  return {
    source: new Blob(['combined'], { type: 'video/mp4' }),
    video: new Blob(['burned'], { type: 'video/mp4' }),
    key: { trackId: 'warmpiano-my-nightly-prayer', volume: 0.3, normalize: true, voice: 'natural', ending: { stopAt: 4.2, soft: true } },
    track: TRACK,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.mocked(fetchTrack).mockResolvedValue(TRACK_BLOB)
  vi.mocked(prepareFinalAudio).mockResolvedValue(PREPARED)
  vi.mocked(joinVideoAndAudio).mockResolvedValue(JOINED)
  vi.mocked(mixMusic).mockResolvedValue(MIXED)
  vi.mocked(finishAudio).mockResolvedValue(FINISHED)
})

describe('mixYoutubeVersion', () => {
  it('builds the audio from the combined video with the YouTube track, ending as the usual BGM did', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    const swap = swapOf()

    expect(await mixYoutubeVersion(swap)).toBe(FINISHED)
    expect(fetchTrack).toHaveBeenCalledWith(TRACK)
    const [source, track, ...rest] = vi.mocked(prepareFinalAudio).mock.calls[0]
    expect(source).toBe(swap.source)
    expect(track).toBe(TRACK_BLOB)
    expect(rest).toEqual([0.3, true, 'natural', { stopAt: 4.2, soft: true }])
    expect(vi.mocked(joinVideoAndAudio).mock.calls[0][0]).toBe(swap.video)
    expect(markLoudnessNormalized).toHaveBeenCalledWith(JOINED)
    expect(vi.mocked(finishAudio).mock.calls[0]).toEqual([JOINED, { voice: 'none', normalize: true }])
    expect(mixMusic).not.toHaveBeenCalled()
  })

  it('mixes into the burned video with the same volume, voice and ending without WebCodecs', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    const swap = swapOf()

    await mixYoutubeVersion(swap)
    const [video, track, ...rest] = vi.mocked(mixMusic).mock.calls[0]
    expect(video).toBe(swap.video)
    expect(track).toBe(TRACK_BLOB)
    expect(rest).toEqual([0.3, 'natural', { stopAt: 4.2, soft: true }])
    expect(prepareFinalAudio).not.toHaveBeenCalled()
  })

  it('mixes a video once per swap, and again after a failure', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    const swap = swapOf()
    await mixYoutubeVersion(swap)
    await mixYoutubeVersion({ ...swap })
    expect(mixMusic).toHaveBeenCalledTimes(1)

    const other = swapOf()
    vi.mocked(mixMusic).mockRejectedValueOnce(new Error('mix failed'))
    await expect(mixYoutubeVersion(other)).rejects.toThrow('mix failed')
    expect(await mixYoutubeVersion(other)).toBe(FINISHED)
  })
})
