import { describe, expect, it, vi, beforeEach } from 'vitest'
import { heardShotFailureText, lineEndOf, makeHeardShot, NotEnoughListeningError, planHeardShot } from './heardShot'
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
  it('takes the line from the loudest stretch, past a faint sound when the recording starts', () => {
    // The take of "So what do you guys eat in Japan?": a soft sound at 0-0.44s, the line at 2.06-4.12s.
    const plan = planHeardShot(region({
      speechStart: 0, speechEnd: 10.16, ceiling: 10.17, duration: 10.17,
      pauses: [{ start: 0.44, end: 2.04 }, { start: 4.22, end: 8.2 }],
      loudest: { start: 2.06, end: 4.12 },
    }))
    expect(plan.voice.start).toBeCloseTo(1.76)
    expect(plan.voice.end).toBeCloseTo(4.42)
    expect(plan.listen.start).toBeCloseTo(4.37)
    expect(plan.stretch).toBe(1)
  })

  it('shows the listening after the line for as long as the line, when there is that much', () => {
    const plan = planHeardShot(region())
    expect(plan.voice.start).toBeCloseTo(0.7)
    expect(plan.voice.end).toBeCloseTo(3.3)
    expect(plan.listen.start).toBeCloseTo(3.25)
    expect(plan.listen.end - plan.listen.start).toBeCloseTo(2.6)
    expect(plan.stretch).toBe(1)
  })

  it('slows a short listening down to last as long as the line', () => {
    // Stopped about a second and a half after the line: 4.45 - 0.2 - 3.25 = 1s of listening for 2.6s of voice.
    const plan = planHeardShot(region({ ceiling: 4.45, duration: 4.45 }))
    expect(plan.listen.end - plan.listen.start).toBeCloseTo(1)
    expect(plan.stretch).toBeCloseTo(2.6)
  })

  it('keeps the voice clear of the taps before and after it', () => {
    const plan = planHeardShot(region({ speechStart: 0.5, floor: 0.45 }))
    expect(plan.voice.start).toBeCloseTo(0.45)
  })

  it('listens for as long as a quicker or slower voice lasts', () => {
    const quick = planHeardShot(region(), 1.25)
    expect(quick.listen.end - quick.listen.start).toBeCloseTo(2.6 / 1.25)
    const slow = planHeardShot(region(), 0.85)
    expect(slow.listen.end - slow.listen.start).toBeCloseTo(2.6 / 0.85)
  })

  it('says how much longer to listen when there is almost none', () => {
    try {
      // 3.75 - 0.2 - 3.25 = 0.3s of listening; a 2.6s voice needs at least 2.6 / 6 = 0.43s.
      planHeardShot(region({ ceiling: 3.75, duration: 3.75 }))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(NotEnoughListeningError)
      expect((err as NotEnoughListeningError).missingSeconds).toBeCloseTo(0.133, 2)
      expect(heardShotFailureText(err)).toBe('セリフのあと、あと約0.2秒長く黙って聞く顔をしてから止めてください')
    }
  })

  it('needs more listening for a long line, so it is slowed at most six times', () => {
    // A 9.3s voice needs about 1.55s of listening.
    expect(() => planHeardShot(region({ speechEnd: 9.7, ceiling: 11.4, duration: 11.4 }))).toThrow(NotEnoughListeningError)
    expect(planHeardShot(region({ speechEnd: 9.7, ceiling: 13, duration: 13 })).stretch).toBeLessThanOrEqual(6)
  })
})

describe('lineEndOf', () => {
  it('ends the line at the first long silence, not at a breath heard later', () => {
    // The line is 1–3s; a rustle at 5.8–6.1s was joined onto the speech.
    const noisy = region({ speechEnd: 6.1, pauses: [{ start: 1.8, end: 2.0 }, { start: 3, end: 5.8 }] })
    expect(lineEndOf(noisy)).toBe(3)
    const plan = planHeardShot({ ...noisy, ceiling: 5.8 })
    expect(plan.voice.end).toBeCloseTo(3.3)
    expect(plan.listen.start).toBeCloseTo(3.25)
    // The rustle and the "stop" sound don't cut the listening short: the take runs to 8s.
    expect(plan.listen.end - plan.listen.start).toBeCloseTo(2.6)
  })

  it('keeps a short pause inside the line', () => {
    expect(lineEndOf(region({ pauses: [{ start: 1.5, end: 2 }] }))).toBe(3)
    expect(lineEndOf(region())).toBe(3)
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
