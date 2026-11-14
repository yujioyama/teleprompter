/**
 * Moving a voice's formants (the resonances that make it sound like a
 * bigger or smaller person) separately from its pitch. A pitch shift alone
 * moves both together, which is what makes a raised voice sound like
 * helium: a child's voice is far higher than an adult's, but its formants
 * are only a little higher.
 *
 * Each short frame's spectrum is divided by its envelope (found by smoothing
 * the cepstrum) and multiplied by that envelope stretched by `ratio`, so the
 * harmonics (the pitch) stay where they are and only the resonances move.
 */

const FRAME = 1024
const HOP = FRAME / 4
/** The envelope keeps the cepstrum below this many seconds: under a voice's period, above its resonances. */
const LIFTER_S = 0.0012
/** Rounds of lifting the spectrum to its envelope (see shiftFormants). */
const ENVELOPE_PASSES = 6
/** The most an envelope change may lift or cut any one frequency (as a ratio). */
const MAX_GAIN = 8

/** `samples` with its formants moved `ratio` times higher (below 1: lower), its pitch and length kept. */
export function shiftFormants(samples: Float32Array, sampleRate: number, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-3 || samples.length < FRAME) return samples
  const window = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME)
  const lifter = Math.max(4, Math.round(sampleRate * LIFTER_S))
  const half = FRAME / 2

  // Padded by a frame on each side so the ends get full overlap too.
  const padded = new Float64Array(samples.length + 2 * FRAME)
  padded.set(samples, FRAME)
  const out = new Float64Array(padded.length)
  const norm = new Float64Array(padded.length)

  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  const cre = new Float64Array(FRAME)
  const cim = new Float64Array(FRAME)
  const env = new Float64Array(half + 1)
  const logs = new Float64Array(FRAME)

  for (let start = 0; start + FRAME <= padded.length; start += HOP) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = padded[start + i] * window[i]
      im[i] = 0
    }
    fft(re, im, false)

    // The log-magnitude envelope, by keeping only the low quefrencies. Done
    // a few times over, each time lifting the spectrum to the envelope where
    // it was below (the "true envelope"), so the gaps between the harmonics
    // don't drag it down and it rides on their peaks.
    for (let k = 0; k < FRAME; k++) logs[k] = Math.log(Math.hypot(re[k], im[k]) + 1e-9)
    for (let pass = 0; pass < ENVELOPE_PASSES; pass++) {
      for (let k = 0; k < FRAME; k++) {
        cre[k] = logs[k]
        cim[k] = 0
      }
      fft(cre, cim, true)
      for (let q = lifter; q <= FRAME - lifter; q++) {
        cre[q] = 0
        cim[q] = 0
      }
      fft(cre, cim, false)
      for (let k = 0; k < FRAME; k++) logs[k] = Math.max(logs[k], cre[k])
    }
    for (let k = 0; k <= half; k++) env[k] = cre[k]

    // Each bin takes the envelope from where it was before the shift.
    for (let k = 0; k <= half; k++) {
      const from = Math.min(half, k / ratio)
      const lo = Math.floor(from)
      const hi = Math.min(half, lo + 1)
      const t = from - lo
      const wanted = env[lo] * (1 - t) + env[hi] * t
      const gain = Math.min(MAX_GAIN, Math.max(1 / MAX_GAIN, Math.exp(wanted - env[k])))
      re[k] *= gain
      im[k] *= gain
      if (k > 0 && k < half) {
        re[FRAME - k] = re[k]
        im[FRAME - k] = -im[k]
      }
    }
    fft(re, im, true)
    for (let i = 0; i < FRAME; i++) {
      out[start + i] += re[i] * window[i]
      norm[start + i] += window[i] * window[i]
    }
  }

  const result = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const n = norm[FRAME + i]
    result[i] = n > 1e-6 ? out[FRAME + i] / n : 0
  }
  return result
}

/** In-place radix-2 FFT; `inverse` also divides by the length. */
export function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let start = 0; start < n; start += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < size / 2; k++) {
        const a = start + k
        const b = a + size / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}
