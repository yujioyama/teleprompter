/** Same fade length as the real mix (see mixMusicWebCodecs / buildMixFilterComplex). */
export const BGM_FADE_SECONDS = 1

/**
 * The BGM's fade gains at `t` seconds into a video `duration` long, as the
 * real mix applies them: in over the first second, out over the last.
 */
export function bgmFadeGains(t: number, duration: number): { fadeIn: number; fadeOut: number } {
  const fadeOutStart = Math.max(0, duration - BGM_FADE_SECONDS)
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return {
    fadeIn: clamp(t / BGM_FADE_SECONDS),
    fadeOut: Number.isFinite(duration) ? clamp(1 - (t - fadeOutStart) / BGM_FADE_SECONDS) : 1,
  }
}

/**
 * Plays the chosen BGM live alongside a <video> of the unmixed video, so
 * picking a track or moving the volume slider is heard at once instead of
 * re-mixing (decoding, re-encoding and re-muxing) the whole video each
 * time. The real mix then runs once, when the user moves on.
 *
 * The video keeps playing its own audio at full level and the BGM is played
 * at `volume`: the real mix scales both by one half (like ffmpeg's amix),
 * which changes the overall level but not the balance, and the export step
 * brings the level to target anyway.
 *
 * The BGM is looped from the video's start and follows play, pause and
 * seeks. Degrades to silence (never throws) where Web Audio is missing.
 */
export class BgmPreview {
  private ctx: AudioContext | null = null
  private output: { fadeIn: GainNode; fadeOut: GainNode; volume: GainNode } | null = null
  private buffer: AudioBuffer | null = null
  private node: AudioBufferSourceNode | null = null
  private volume = 1
  private trackToken = 0
  private readonly detach: () => void

  constructor(private readonly video: HTMLVideoElement) {
    const restart = () => this.restart()
    const stop = () => this.stop()
    const events: [string, () => void][] = [
      ['playing', restart],
      ['seeked', restart],
      ['pause', stop],
      ['waiting', stop],
      ['seeking', stop],
      ['ended', stop],
    ]
    for (const [type, listener] of events) video.addEventListener(type, listener)
    this.detach = () => {
      for (const [type, listener] of events) video.removeEventListener(type, listener)
    }
  }

  /**
   * Create/resume the audio output. Call from a tap handler: iOS only lets
   * an AudioContext start inside a user gesture.
   */
  unlock(): void {
    const ctx = this.context()
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => undefined)
  }

  /** Switch to `track` (null for none), restarting it in step with the video. */
  async setTrack(track: Blob | null): Promise<void> {
    const token = ++this.trackToken
    this.stop()
    this.buffer = null
    const ctx = this.context()
    if (!track || !ctx) return
    try {
      const decoded = await ctx.decodeAudioData(await track.arrayBuffer())
      if (token !== this.trackToken) return
      this.buffer = this.fitToVideo(ctx, decoded)
      this.restart()
    } catch (err) {
      console.warn('[BgmPreview] could not decode the track for preview:', err)
    }
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (this.ctx && this.output) this.output.volume.gain.setValueAtTime(volume, this.ctx.currentTime)
  }

  dispose(): void {
    this.trackToken++
    this.detach()
    this.stop()
    this.buffer = null
    this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.output = null
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx
    if (typeof AudioContext === 'undefined') return null
    // Web Audio follows the ringer switch on iOS, unlike the <video> it
    // plays beside; ask for media playback so the BGM isn't silently muted.
    const session = (navigator as { audioSession?: { type: string } }).audioSession
    if (session && session.type === 'auto') session.type = 'playback'
    const ctx = new AudioContext({ latencyHint: 'playback' })
    const fadeIn = ctx.createGain()
    const fadeOut = ctx.createGain()
    const volume = ctx.createGain()
    volume.gain.value = this.volume
    fadeIn.connect(fadeOut).connect(volume).connect(ctx.destination)
    this.ctx = ctx
    this.output = { fadeIn, fadeOut, volume }
    return ctx
  }

  /**
   * Only as much of the track as the video can play is kept: a decoded
   * track is ~40 MB per minute, which a phone shouldn't hold for nothing.
   */
  private fitToVideo(ctx: AudioContext, decoded: AudioBuffer): AudioBuffer {
    const duration = this.video.duration
    if (!Number.isFinite(duration)) return decoded
    const length = Math.ceil((duration + BGM_FADE_SECONDS) * decoded.sampleRate)
    if (length >= decoded.length) return decoded
    const fitted = ctx.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate)
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      fitted.copyToChannel(decoded.getChannelData(c).subarray(0, length), c)
    }
    return fitted
  }

  private restart(): void {
    this.stop()
    const { ctx, output, buffer, video } = this
    if (!ctx || !output || !buffer || video.paused || video.ended) return

    const t = video.currentTime
    const now = ctx.currentTime
    const duration = video.duration
    const gains = bgmFadeGains(t, duration)
    const { fadeIn, fadeOut } = output
    fadeIn.gain.cancelScheduledValues(now)
    fadeIn.gain.setValueAtTime(gains.fadeIn, now)
    if (t < BGM_FADE_SECONDS) fadeIn.gain.linearRampToValueAtTime(1, now + BGM_FADE_SECONDS - t)
    fadeOut.gain.cancelScheduledValues(now)
    fadeOut.gain.setValueAtTime(gains.fadeOut, now)
    if (Number.isFinite(duration)) {
      const fadeOutStart = Math.max(0, duration - BGM_FADE_SECONDS)
      if (t < fadeOutStart) fadeOut.gain.setValueAtTime(1, now + fadeOutStart - t)
      if (t < fadeOutStart + BGM_FADE_SECONDS) {
        fadeOut.gain.linearRampToValueAtTime(0, now + fadeOutStart + BGM_FADE_SECONDS - t)
      }
    }

    const node = ctx.createBufferSource()
    node.buffer = buffer
    // Like the real mix, a track shorter than the video starts over.
    node.loop = true
    node.connect(fadeIn)
    node.start(now, t % buffer.duration)
    this.node = node
  }

  private stop(): void {
    if (!this.node) return
    try {
      this.node.stop()
    } catch {
      // Already stopped.
    }
    this.node.disconnect()
    this.node = null
  }
}
