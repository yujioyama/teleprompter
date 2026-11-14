import { describe, expect, it } from 'vitest'
import { HEARD_VOICES, isHeardVoice, levelVoice, resample, rms, shapeVoice, telephone, timeStretch, voiceSpeed } from './voiceEffects'
import { measureIntegratedLoudness, TARGET_LUFS } from './loudness'

const RATE = 16000

/** A voice-like tone: a fundamental with two overtones. */
function tone(hz: number, seconds = 1): Float32Array {
  const out = new Float32Array(Math.round(RATE * seconds))
  for (let i = 0; i < out.length; i++) {
    const t = (2 * Math.PI * hz * i) / RATE
    out[i] = 0.5 * Math.sin(t) + 0.2 * Math.sin(2 * t) + 0.1 * Math.sin(3 * t)
  }
  return out
}

const sine = (hz: number) => Float32Array.from({ length: RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE))

/** The fundamental, from how often the middle of the sound rises through zero. */
function pitchOf(samples: Float32Array): number {
  const from = Math.floor(samples.length * 0.2)
  const to = Math.floor(samples.length * 0.8)
  // Smoothed, so the overtones don't add crossings of their own.
  const smooth = new Float32Array(to - from)
  for (let i = from; i < to; i++) {
    let sum = 0
    for (let j = -8; j <= 8; j++) sum += samples[i + j]
    smooth[i - from] = sum
  }
  let crossings = 0
  for (let i = 1; i < smooth.length; i++) if (smooth[i - 1] <= 0 && smooth[i] > 0) crossings++
  return (crossings * RATE) / smooth.length
}

describe('timeStretch', () => {
  it('makes the sound longer at the same pitch and level', () => {
    const out = timeStretch(tone(200), RATE, 1.5)
    expect(out.length).toBe(RATE * 1.5)
    expect(pitchOf(out)).toBeCloseTo(200, -1)
    expect(rms(out) / rms(tone(200))).toBeGreaterThan(0.85)
    expect(rms(out) / rms(tone(200))).toBeLessThan(1.15)
  })

  it('makes it shorter too', () => {
    const out = timeStretch(tone(200), RATE, 0.8)
    expect(out.length).toBe(RATE * 0.8)
    expect(pitchOf(out)).toBeCloseTo(200, -1)
  })

  it('has no gap or burst anywhere along it', () => {
    const out = timeStretch(tone(200), RATE, 1.335)
    const whole = rms(out)
    for (let at = 0; at + 800 <= out.length; at += 800) {
      const part = rms(out.subarray(at, at + 800))
      expect(part / whole).toBeGreaterThan(0.6)
      expect(part / whole).toBeLessThan(1.4)
    }
  })
})

describe('shapeVoice', () => {
  const voice = tone(200)

  it('leaves the natural voice alone', () => {
    expect(shapeVoice(voice, RATE, undefined)).toBe(voice)
    expect(shapeVoice(voice, RATE, 'natural')).toBe(voice)
  })

  it.each([
    ['kid', 2 ** (11 / 12)],
    ['high', 2 ** (7 / 12)],
    ['low', 2 ** (-2 / 12)],
  ] as const)('makes the %s voice higher or lower without changing how long the line takes', (name, ratio) => {
    const out = shapeVoice(voice, RATE, name)
    expect(out.length).toBe(voice.length)
    expect(pitchOf(out) / 200).toBeCloseTo(ratio, 1)
    expect(voiceSpeed(name)).toBe(1)
  })

  it.each([
    ['fast', 1.25],
    ['slow', 0.85],
  ] as const)('plays the %s voice quicker or slower, higher or lower with it', (name, speed) => {
    const out = shapeVoice(voice, RATE, name)
    expect(out.length).toBe(Math.round(voice.length / speed))
    expect(pitchOf(out) / 200).toBeCloseTo(speed, 1)
    expect(voiceSpeed(name)).toBe(speed)
  })

  it('keeps the phone voice as long and as loud, at the same pitch', () => {
    const out = shapeVoice(tone(400), RATE, 'phone')
    expect(out.length).toBe(RATE)
    expect(rms(out) / rms(tone(400))).toBeCloseTo(1, 1)
  })
})

describe('telephone', () => {
  // Quiet enough not to reach the clip, so only the band is measured.
  const quiet = (hz: number) => sine(hz).map(v => v * 0.05)
  const through = (hz: number) => {
    const out = Float32Array.from(quiet(hz))
    // Without the loudness make-up: band-limited and clipped only.
    const shaped = telephone(Float32Array.from([...quiet(1000), ...out]), RATE)
    return rms(shaped.subarray(RATE + 2000)) / rms(shaped.subarray(2000, RATE))
  }

  it('lets the middle of the voice through and cuts the bass and the top', () => {
    expect(through(1000)).toBeCloseTo(1, 1)
    expect(through(80)).toBeLessThan(0.1)
    expect(through(6500)).toBeLessThan(0.15)
  })
})

describe('resample', () => {
  it('plays faster and higher by the rate', () => {
    const out = resample(sine(200), 2)
    expect(out.length).toBe(RATE / 2)
    expect(pitchOf(out)).toBeCloseTo(400, -1)
  })
})

describe('isHeardVoice', () => {
  it('knows the voices by name', () => {
    expect(HEARD_VOICES.every(isHeardVoice)).toBe(true)
    expect(isHeardVoice('robot')).toBe(false)
    expect(isHeardVoice(undefined)).toBe(false)
  })
})

describe('levelVoice', () => {
  it('brings a soft line and a loud line to the same loudness', () => {
    const soft = tone(200, 2).map(v => v * 0.05)
    const loud = tone(200, 2).map(v => v * 0.8)
    const softLevel = measureIntegratedLoudness([levelVoice(soft, RATE)], RATE)
    const loudLevel = measureIntegratedLoudness([levelVoice(loud, RATE)], RATE)
    expect(Math.abs(softLevel - loudLevel)).toBeLessThan(1.5)
    expect(Math.abs(loudLevel - TARGET_LUFS)).toBeLessThan(1.5)
  })
})
