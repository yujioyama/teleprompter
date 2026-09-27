/**
 * Loudness measurement and correction for the final video's audio, in plain
 * JS so the WebCodecs and ffmpeg.wasm export paths share one implementation.
 *
 * Instagram and TikTok both play back around -14 LUFS, so a video delivered
 * at that level is neither turned down nor left sounding quieter than the
 * rest of the feed.
 */

export const TARGET_LUFS = -14

/**
 * Sample-peak ceiling. The platforms ask for at most -1 dBTP (true peak);
 * true peak needs oversampling, which this skips, and the AAC encode after
 * this overshoots (by ~0.4 dB with ffmpeg's encoder, measured), so the
 * extra 1 dB covers both.
 */
export const PEAK_CEILING_DB = -2

/**
 * A video with almost no speech in it (room noise only) would otherwise get
 * a huge boost that just makes the noise loud.
 */
const MAX_BOOST_DB = 20

/** Closer than this to the target, re-encoding isn't worth a generation loss. */
const TOLERANCE_DB = 0.5

const LOOKAHEAD_SECONDS = 0.005
const RELEASE_SECONDS = 0.1

interface Biquad {
  b: [number, number, number]
  a: [number, number]
}

/**
 * BS.1770's K-weighting (a high-shelf "head" filter, then a high-pass),
 * derived for any sample rate the same way libebur128 (ffmpeg's ebur128 and
 * loudnorm filters) does.
 */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / sampleRate)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const shelf: Biquad = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  }

  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / sampleRate)
  a0 = 1 + K / Q + K * K
  const highPass: Biquad = {
    b: [1, -2, 1],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  }
  return [shelf, highPass]
}

/**
 * Integrated loudness in LUFS (ITU-R BS.1770-4: 400 ms blocks at 75%
 * overlap, -70 LUFS absolute gate, -10 LU relative gate), or -Infinity when
 * nothing passes the gates. Every channel is weighted 1.0, which is right
 * for the mono/stereo audio this app produces.
 */
export function measureIntegratedLoudness(channels: Float32Array[], sampleRate: number): number {
  // Blocks are four consecutive 100 ms segments, so filtered energy is
  // summed per segment once and each block adds up four of them.
  const segmentLength = Math.round(sampleRate * 0.1)
  const length = channels.length > 0 ? channels[0].length : 0
  const segmentCount = Math.floor(length / segmentLength)
  if (segmentCount < 4) return -Infinity

  const segmentEnergy = new Float64Array(segmentCount)
  const [shelf, highPass] = kWeighting(sampleRate)
  for (const samples of channels) {
    // Direct form I, both stages inline; the state is per channel.
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    let u1 = 0, u2 = 0, z1 = 0, z2 = 0
    for (let s = 0; s < segmentCount; s++) {
      let sum = 0
      const end = (s + 1) * segmentLength
      for (let i = s * segmentLength; i < end; i++) {
        const x = samples[i]
        const y = shelf.b[0] * x + shelf.b[1] * x1 + shelf.b[2] * x2 - shelf.a[0] * y1 - shelf.a[1] * y2
        x2 = x1; x1 = x; y2 = y1; y1 = y
        const z = highPass.b[0] * y + highPass.b[1] * u1 + highPass.b[2] * u2 - highPass.a[0] * z1 - highPass.a[1] * z2
        u2 = u1; u1 = y; z2 = z1; z1 = z
        sum += z * z
      }
      segmentEnergy[s] += sum
    }
  }

  const blockCount = segmentCount - 3
  const blockPower = new Float64Array(blockCount)
  for (let b = 0; b < blockCount; b++) {
    blockPower[b] =
      (segmentEnergy[b] + segmentEnergy[b + 1] + segmentEnergy[b + 2] + segmentEnergy[b + 3]) / (4 * segmentLength)
  }

  const toLufs = (power: number) => -0.691 + 10 * Math.log10(power)
  const gatedMean = (threshold: number) => {
    let sum = 0
    let count = 0
    for (const power of blockPower) {
      if (toLufs(power) > threshold) {
        sum += power
        count++
      }
    }
    return count > 0 ? sum / count : 0
  }

  const absoluteGated = gatedMean(-70)
  if (absoluteGated === 0) return -Infinity
  const relativeGate = Math.max(-70, toLufs(absoluteGated) - 10)
  return toLufs(gatedMean(relativeGate))
}

/**
 * The gain in dB that brings this audio to TARGET_LUFS, or null when it's
 * silent or already close enough that it should be left as is.
 */
export function planLoudnessGain(channels: Float32Array[], sampleRate: number): number | null {
  const measured = measureIntegratedLoudness(channels, sampleRate)
  if (!Number.isFinite(measured)) return null
  const gainDb = Math.min(MAX_BOOST_DB, TARGET_LUFS - measured)
  if (Math.abs(gainDb) >= TOLERANCE_DB) return gainDb

  const ceiling = Math.pow(10, PEAK_CEILING_DB / 20)
  const gain = Math.pow(10, gainDb / 20)
  for (const samples of channels) {
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) * gain > ceiling) return gainDb
    }
  }
  return null
}

/**
 * Apply `gainDb` to every channel in place, with a lookahead peak limiter
 * holding every sample at or below PEAK_CEILING_DB.
 *
 * Speech peaks sit well above its loudness, so reaching -14 LUFS with a
 * plain gain would often clip plosives; the limiter pulls the gain down just
 * around those peaks instead of turning the whole video down.
 *
 * The gain curve is, per sample: the gain that exact sample needs, then the
 * minimum of that over the next `lookahead` samples, then a slow release
 * back up, then a moving average over the previous `lookahead` samples.
 * Every sample within `lookahead` before a peak already sees that peak's
 * gain after the minimum, so the average over them can't exceed it: the
 * gain ramps smoothly down into each peak without ever letting it through.
 */
export function applyGainWithLimiter(channels: Float32Array[], sampleRate: number, gainDb: number): void {
  const length = channels.length > 0 ? channels[0].length : 0
  if (length === 0) return
  const gain = Math.pow(10, gainDb / 20)
  const ceiling = Math.pow(10, PEAK_CEILING_DB / 20)
  const lookahead = Math.max(1, Math.round(sampleRate * LOOKAHEAD_SECONDS))
  const window = lookahead + 1

  // The gain each sample needs on its own.
  const curve = new Float32Array(length)
  let limited = false
  for (let i = 0; i < length; i++) {
    let peak = 0
    for (const samples of channels) peak = Math.max(peak, Math.abs(samples[i]))
    const needed = peak * gain > ceiling ? ceiling / (peak * gain) : 1
    if (needed < 1) limited = true
    curve[i] = needed
  }

  if (limited) {
    // Minimum over [i, i + lookahead], in place from the end: a monotonic
    // deque kept in a ring buffer, holding values alongside their indices
    // since the entries it refers to are overwritten as it goes.
    const dequeIndex = new Int32Array(window + 1)
    const dequeValue = new Float32Array(window + 1)
    const size = window + 1
    let head = 0
    let count = 0
    for (let i = length - 1; i >= 0; i--) {
      const value = curve[i]
      while (count > 0 && dequeValue[(head + count - 1) % size] >= value) count--
      dequeIndex[(head + count) % size] = i
      dequeValue[(head + count) % size] = value
      count++
      if (dequeIndex[head] > i + lookahead) {
        head = (head + 1) % size
        count--
      }
      curve[i] = dequeValue[head]
    }

    // Release: follow drops at once, recover slowly.
    const release = Math.exp(-1 / (sampleRate * RELEASE_SECONDS))
    let held = curve[0]
    for (let i = 0; i < length; i++) {
      held = Math.min(curve[i], release * held + (1 - release) * curve[i])
      curve[i] = held
    }

    // Moving average over [i - lookahead, i], in place via a ring of the
    // values leaving the window.
    const ring = new Float32Array(window)
    let sum = 0
    for (let i = 0; i < length; i++) {
      const value = curve[i]
      if (i >= window) sum -= ring[i % window]
      ring[i % window] = value
      sum += value
      curve[i] = sum / Math.min(i + 1, window)
    }
  }

  for (const samples of channels) {
    for (let i = 0; i < length; i++) {
      // The clamp only absorbs float rounding in the running average.
      const v = samples[i] * gain * curve[i]
      samples[i] = v > ceiling ? ceiling : v < -ceiling ? -ceiling : v
    }
  }
}
