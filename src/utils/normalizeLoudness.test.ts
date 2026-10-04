import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildDecodePcmArgs, buildReplaceAudioArgs, normalizeLoudness, markLoudnessNormalized } from './normalizeLoudness'
import { measureIntegratedLoudness, TARGET_LUFS } from './loudness'
import { canUseWebCodecs } from './webcodecs/support'
import { normalizeLoudnessWebCodecs } from './webcodecs/normalizeLoudnessWebCodecs'
import { getFFmpeg } from './ffmpegClient'
import { execFFmpeg } from './execFFmpeg'

vi.mock('./webcodecs/support', () => ({ canUseWebCodecs: vi.fn() }))
vi.mock('./webcodecs/normalizeLoudnessWebCodecs', () => ({ normalizeLoudnessWebCodecs: vi.fn() }))
vi.mock('./ffmpegClient', () => ({ getFFmpeg: vi.fn() }))
vi.mock('./execFFmpeg', () => ({ execFFmpeg: vi.fn(async () => undefined) }))

/** Interleaved stereo 1 kHz sine at 48 kHz, as ffmpeg's f32le decode writes it. */
function stereoPcm(amplitude: number, seconds: number): Uint8Array {
  const frames = 48000 * seconds
  const pcm = new Float32Array(frames * 2)
  for (let i = 0; i < frames; i++) {
    const v = amplitude * Math.sin((2 * Math.PI * 1000 * i) / 48000)
    pcm[2 * i] = v
    pcm[2 * i + 1] = v
  }
  return new Uint8Array(pcm.buffer)
}

function loudnessOf(bytes: Uint8Array): number {
  const pcm = new Float32Array(bytes.slice().buffer)
  const left = pcm.filter((_, i) => i % 2 === 0)
  const right = pcm.filter((_, i) => i % 2 === 1)
  return measureIntegratedLoudness([left, right], 48000)
}

const written = new Map<string, Uint8Array>()
let decodedPcm = stereoPcm(0.05, 3)
const fakeFFmpeg = {
  writeFile: vi.fn(async (name: string, data: Uint8Array) => {
    written.set(name, data)
    return true
  }),
  readFile: vi.fn(async (name: string) => (name.endsWith('.pcm') ? decodedPcm : new Uint8Array([1, 2, 3]))),
  deleteFile: vi.fn(async (name: string) => name.length > 0),
}

beforeEach(() => {
  vi.clearAllMocks()
  written.clear()
  decodedPcm = stereoPcm(0.05, 3)
  vi.mocked(getFFmpeg).mockResolvedValue(fakeFFmpeg as never)
})

const video = () => new Blob(['v'], { type: 'video/mp4' })

describe('normalizeLoudness ffmpeg args', () => {
  it('decodes the audio to 48 kHz stereo float PCM', () => {
    expect(buildDecodePcmArgs('in.mp4', 'in.pcm')).toEqual([
      '-i', 'in.mp4', '-vn', '-ac', '2', '-ar', '48000', '-f', 'f32le', 'in.pcm',
    ])
  })

  it('copies the video and encodes the corrected PCM as the only audio', () => {
    const args = buildReplaceAudioArgs('in.mp4', 'out.pcm', 'out.mp4')
    expect(args.slice(0, 10)).toEqual(['-i', 'in.mp4', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', 'out.pcm'])
    expect(args).toEqual(expect.arrayContaining(['-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac']))
    expect(args[args.length - 1]).toBe('out.mp4')
  })
})

describe('normalizeLoudness backend selection', () => {
  it('uses WebCodecs when available, without loading ffmpeg', async () => {
    const out = new Blob(['wc'], { type: 'video/mp4' })
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(normalizeLoudnessWebCodecs).mockResolvedValue(out)

    await expect(normalizeLoudness(video())).resolves.toBe(out)
    expect(getFFmpeg).not.toHaveBeenCalled()
  })

  it('falls back to ffmpeg when the WebCodecs pass fails', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(normalizeLoudnessWebCodecs).mockRejectedValue(new Error('decode failed'))

    const out = await normalizeLoudness(video())
    expect(getFFmpeg).toHaveBeenCalled()
    expect(out.type).toBe('video/mp4')
  })

  it('reuses the result for the same video instead of redoing it', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(normalizeLoudnessWebCodecs).mockResolvedValue(new Blob(['wc']))
    const input = video()

    const first = await normalizeLoudness(input)
    await expect(normalizeLoudness(input)).resolves.toBe(first)
    expect(normalizeLoudnessWebCodecs).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure instead of caching it', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    vi.mocked(getFFmpeg).mockRejectedValueOnce(new Error('ffmpeg load failed'))
    const input = video()

    await expect(normalizeLoudness(input)).rejects.toThrow('ffmpeg load failed')
    await expect(normalizeLoudness(input)).resolves.toBeInstanceOf(Blob)
  })
})

describe('normalizeLoudness ffmpeg path', () => {
  beforeEach(() => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
  })

  it('re-encodes the audio at the target loudness', async () => {
    const out = await normalizeLoudness(video())

    const corrected = written.get('loudness-out.pcm')
    expect(corrected).toBeDefined()
    expect(loudnessOf(corrected!)).toBeCloseTo(TARGET_LUFS, 1)
    const calls = vi.mocked(execFFmpeg).mock.calls
    const lastArgs = calls[calls.length - 1][1]
    expect(lastArgs[lastArgs.length - 1]).toBe('loudness-out.mp4')
    expect(out.type).toBe('video/mp4')
  })

  it('returns the video untouched when it is already on target', async () => {
    decodedPcm = stereoPcm(Math.pow(10, TARGET_LUFS / 20), 3)
    const input = video()

    await expect(normalizeLoudness(input)).resolves.toBe(input)
    expect(execFFmpeg).toHaveBeenCalledTimes(1)
    expect(written.has('loudness-out.pcm')).toBe(false)
  })

  it('cleans up its files in ffmpeg\'s filesystem', async () => {
    await normalizeLoudness(video())
    const deleted = fakeFFmpeg.deleteFile.mock.calls.map(c => c[0])
    expect(deleted).toEqual(expect.arrayContaining([
      'loudness-in.mp4', 'loudness-in.pcm', 'loudness-out.pcm', 'loudness-out.mp4',
    ]))
  })
})

describe('markLoudnessNormalized', () => {
  it('hands a blob already at the target straight back, without decoding it', async () => {
    vi.mocked(canUseWebCodecs).mockClear()
    const ready = new Blob(['already-normalized'], { type: 'video/mp4' })
    markLoudnessNormalized(ready)
    await expect(normalizeLoudness(ready)).resolves.toBe(ready)
    expect(canUseWebCodecs).not.toHaveBeenCalled()
  })
})
