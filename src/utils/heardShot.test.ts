import { describe, expect, it, vi, beforeEach } from 'vitest'
import { heardShotFailureText, makeHeardShot, NotEnoughListeningError, planHeardShot } from './heardShot'
import { detectSpeech, type SpeechRegion } from './detectSpeechBounds'
import { canUseWebCodecs } from './webcodecs/support'
import { buildHeardShotWebCodecs } from './webcodecs/heardShot'

vi.mock('./detectSpeechBounds', async importOriginal => ({
  ...(await importOriginal<typeof import('./detectSpeechBounds')>()),
  detectSpeech: vi.fn(),
}))
vi.mock('./webcodecs/support', async importOriginal => ({
  ...(await importOriginal<typeof import('./webcodecs/support')>()),
  canUseWebCodecs: vi.fn(async () => true),
}))
vi.mock('./webcodecs/heardShot', () => ({ buildHeardShotWebCodecs: vi.fn(async () => new Blob(['heard'])) }))

const region = (over: Partial<SpeechRegion> = {}): SpeechRegion => ({
  speechStart: 1,
  speechEnd: 3,
  floor: 0,
  ceiling: 8,
  duration: 8,
  ...over,
})

describe('planHeardShot', () => {
  it('shows the listening after the line for as long as the line takes', () => {
    const plan = planHeardShot(region())
    expect(plan.voice.start).toBeCloseTo(0.85)
    expect(plan.voice.end).toBeCloseTo(3.15)
    expect(plan.listen.start).toBeCloseTo(3.4)
    expect(plan.listen.end - plan.listen.start).toBeCloseTo(plan.voice.end - plan.voice.start)
  })

  it('keeps the voice clear of the taps before and after it', () => {
    const plan = planHeardShot(region({ speechStart: 0.5, floor: 0.45 }))
    expect(plan.voice.start).toBeCloseTo(0.45)
  })

  it('listens for as long as a quicker or slower voice lasts', () => {
    const quick = planHeardShot(region(), 1.25)
    expect(quick.listen.end - quick.listen.start).toBeCloseTo(2.3 / 1.25)
    const slow = planHeardShot(region(), 0.85)
    expect(slow.listen.end - slow.listen.start).toBeCloseTo(2.3 / 0.85)
  })

  it('says how much longer to listen when the take stops too soon', () => {
    try {
      planHeardShot(region({ ceiling: 5, duration: 5.2 }))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(NotEnoughListeningError)
      // Needs 3.4 + 2.3 = 5.7; the take is usable up to 5 - 0.3 = 4.7.
      expect((err as NotEnoughListeningError).missingSeconds).toBeCloseTo(1)
      expect(heardShotFailureText(err)).toBe('セリフのあと、あと約1秒長く黙って撮ってください')
    }
  })
})

describe('makeHeardShot', () => {
  beforeEach(() => {
    vi.mocked(detectSpeech).mockReset().mockResolvedValue(region())
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(buildHeardShotWebCodecs).mockClear()
  })

  it('builds the clip from where the speech is', async () => {
    const take = new Blob(['take'])
    const out = await makeHeardShot(take)
    expect(await out.text()).toBe('heard')
    expect(buildHeardShotWebCodecs).toHaveBeenCalledWith(take, planHeardShot(region()), undefined)

    await makeHeardShot(take, 'fast')
    expect(buildHeardShotWebCodecs).toHaveBeenLastCalledWith(take, planHeardShot(region(), 1.25), 'fast')
  })

  it('rejects without speech or without WebCodecs', async () => {
    vi.mocked(detectSpeech).mockResolvedValueOnce(null)
    await expect(makeHeardShot(new Blob(['take']))).rejects.toThrow('no speech')
    vi.mocked(canUseWebCodecs).mockResolvedValueOnce(false)
    await expect(makeHeardShot(new Blob(['take']))).rejects.toThrow('WebCodecs')
    expect(heardShotFailureText(new Error('x'))).toContain('見つけられない')
  })
})
