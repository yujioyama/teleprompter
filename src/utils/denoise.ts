import { fft } from './formant'

/**
 * Taking the room's hiss out of the other person's line. Their line is
 * recorded ahead with the phone further from the mouth than when we speak
 * our own lines, so it is quieter, and levelVoice then lifts it (and the
 * hiss with it) to our loudness: a シャー under every 相手のセリフ shot.
 *
 * Spectral gating: the hiss is learned from the quietest frames of the
 * recording (the breath before and after the line), and each frequency of
 * each frame is turned down by how much of it is that hiss. Speech is far
 * louder than the hiss at the frequencies it uses, so it passes; the gaps
 * between words, and the padding around the line, go quiet.
 */

const FRAME = 1024
const HOP = FRAME / 4
/** Share of the frames, the quietest, the hiss is learned from. */
const QUIET_SHARE = 0.2
/** Fewer quiet frames than this and there is nothing to learn the hiss from. */
const MIN_QUIET_FRAMES = 4
/**
 * The loud frames must be at least this much louder (dB) than the quiet
 * ones: otherwise the "quiet" frames are speech too, and gating them would
 * eat the voice.
 */
const MIN_CONTRAST_DB = 12
/** How many times the learned hiss is taken off (a little over 1, so it doesn't come back as a fizz). */
const OVER_SUBTRACT = 1.5
/** The hiss is turned down to this, not to nothing: a dead silence between words sounds cut out. */
export const NOISE_FLOOR_GAIN = 0.12
/** How quickly a frequency closes again after speech (per hop), so word endings fade instead of chopping. */
const RELEASE = 0.55

/** `samples` (mono) with the steady room noise turned down; the length is kept. */
export function reduceNoise(samples: Float32Array): Float32Array {
  if (samples.length < FRAME * 4) return samples
  const half = FRAME / 2
  const window = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME)

  const padded = new Float64Array(samples.length + 2 * FRAME)
  padded.set(samples, FRAME)
  const starts: number[] = []
  for (let start = 0; start + FRAME <= padded.length; start += HOP) starts.push(start)

  // Every frame's spectrum, kept for the second pass.
  const spectra = starts.map(start => {
    const re = new Float64Array(FRAME)
    const im = new Float64Array(FRAME)
    for (let i = 0; i < FRAME; i++) re[i] = padded[start + i] * window[i]
    fft(re, im, false)
    return { re, im }
  })
  // Frames that lie mostly in the padding are silent by construction, not by the room: left out of the learning.
  const inside = starts.map(start => start >= FRAME - HOP && start + FRAME <= samples.length + FRAME + HOP)
  const energy = spectra.map(({ re, im }) => {
    let sum = 0
    for (let k = 0; k <= half; k++) sum += re[k] * re[k] + im[k] * im[k]
    return sum
  })

  const ranked = energy.map((e, i) => ({ e, i })).filter(({ i }) => inside[i]).sort((a, b) => a.e - b.e)
  const quietCount = Math.floor(ranked.length * QUIET_SHARE)
  if (quietCount < MIN_QUIET_FRAMES) return samples
  const quiet = ranked.slice(0, quietCount)
  const loud = ranked.slice(-quietCount)
  const mean = (list: { e: number }[]) => list.reduce((s, x) => s + x.e, 0) / list.length
  const quietEnergy = mean(quiet)
  if (quietEnergy <= 0) return samples
  if (10 * Math.log10(mean(loud) / quietEnergy) < MIN_CONTRAST_DB) return samples

  const noise = new Float64Array(half + 1)
  for (const { i } of quiet) {
    const { re, im } = spectra[i]
    for (let k = 0; k <= half; k++) noise[k] += Math.hypot(re[k], im[k]) / quiet.length
  }

  const out = new Float64Array(padded.length)
  const norm = new Float64Array(padded.length)
  const raw = new Float64Array(half + 1)
  const gains = new Float64Array(half + 1).fill(NOISE_FLOOR_GAIN)
  spectra.forEach(({ re, im }, f) => {
    for (let k = 0; k <= half; k++) {
      const magnitude = Math.hypot(re[k], im[k])
      raw[k] = magnitude > 0 ? Math.max(NOISE_FLOOR_GAIN, 1 - (OVER_SUBTRACT * noise[k]) / magnitude) : NOISE_FLOOR_GAIN
    }
    for (let k = 0; k <= half; k++) {
      // Neighbouring frequencies averaged, so single bins don't twinkle on and off ("musical noise").
      const g = (raw[Math.max(0, k - 1)] + raw[k] + raw[Math.min(half, k + 1)]) / 3
      // Opens at once, closes over a few hops.
      gains[k] = g >= gains[k] ? g : gains[k] + (g - gains[k]) * RELEASE
      re[k] *= gains[k]
      im[k] *= gains[k]
      if (k > 0 && k < half) {
        re[FRAME - k] = re[k]
        im[FRAME - k] = -im[k]
      }
    }
    fft(re, im, true)
    const start = starts[f]
    for (let i = 0; i < FRAME; i++) {
      out[start + i] += re[i] * window[i]
      norm[start + i] += window[i] * window[i]
    }
  })

  const result = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const n = norm[FRAME + i]
    result[i] = n > 1e-6 ? out[FRAME + i] / n : 0
  }
  return result
}
