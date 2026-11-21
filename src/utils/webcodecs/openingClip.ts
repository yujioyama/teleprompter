import { ALL_FORMATS, AudioBufferSource, BlobSource, Input, Quality, VideoSample, VideoSampleSink, VideoSampleSource } from 'mediabunny'
import { createMp4Output, runOutput } from './audioTrack'
import { OUTPUT_CHANNELS, OUTPUT_FRAME_RATE, OUTPUT_HEIGHT, OUTPUT_SAMPLE_RATE, OUTPUT_WIDTH } from './support'
import { coverTimeOf, drawOpeningCard, layoutOpening, type OpeningCardPlan } from '../openingCard'

/**
 * Line 1's first frame (at `at` seconds into its take) at the output size,
 * as the shot's normalize fits it: the whole picture, letterboxed in black.
 */
export async function firstFrameOf(take: Blob, at: number): Promise<OffscreenCanvas> {
  const input = new Input({ source: new BlobSource(take), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('the take has no picture')
    const sink = new VideoSampleSink(track)
    const start = await track.getFirstTimestamp()
    const sample = (await sink.getSample(Math.max(start, at))) ?? (await sink.getSample(start))
    if (!sample) throw new Error('no frame at the start of line 1')
    const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    try {
      sample.drawWithFit(ctx, { fit: 'contain' })
    } finally {
      sample.close()
    }
    return canvas
  } finally {
    input.dispose()
  }
}

/**
 * 冒頭カード as a clip of its own: every frame drawn over `background` (line
 * 1's first frame), with its voice (mono, any rate) from the plan's
 * `voiceAt`, over silence otherwise. The burn normalizes it like a take, so
 * it joins the shots by packet copy.
 */
export async function rawOpeningClipWebCodecs(
  plan: OpeningCardPlan,
  background: CanvasImageSource,
  voice?: { samples: Float32Array; sampleRate: number } | null,
): Promise<Blob> {
  const { timing } = plan
  const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  const layout = layoutOpening(plan.text, OUTPUT_WIDTH, OUTPUT_HEIGHT, (t, font) => {
    ctx.font = font
    return ctx.measureText(t).width
  }, plan.ja)
  const frames = Math.round(timing.seconds * OUTPUT_FRAME_RATE)
  const frameSeconds = 1 / OUTPUT_FRAME_RATE

  const videoSource = new VideoSampleSource({ codec: 'avc', quality: new Quality('very-high') })
  const audioSource = new AudioBufferSource({ codec: 'aac', quality: new Quality('high') })
  const output = createMp4Output()
  output.addVideoTrack(videoSource, { frameRate: OUTPUT_FRAME_RATE })
  output.addAudioTrack(audioSource)
  const buffer = await runOutput(output, async () => {
    for (let i = 0; i < frames; i++) {
      drawOpeningCard(ctx, background, layout, timing, i * frameSeconds)
      const sample = new VideoSample(canvas, { timestamp: i * frameSeconds, duration: frameSeconds })
      try {
        await videoSource.add(sample)
      } finally {
        sample.close()
      }
    }
    videoSource.close()
    await audioSource.add(await openingAudio(timing.seconds, timing.voiceAt, voice))
    audioSource.close()
  })
  canvas.width = 0
  canvas.height = 0
  if (!buffer) throw new Error('could not encode the opening card')
  return new Blob([buffer], { type: 'video/mp4' })
}

/** Silence a little past the card's end (so a trim never finds it short), with the voice from `voiceAt`. */
async function openingAudio(seconds: number, voiceAt: number | null, voice?: { samples: Float32Array; sampleRate: number } | null): Promise<AudioBuffer> {
  const length = Math.ceil((seconds + 0.1) * OUTPUT_SAMPLE_RATE)
  if (!voice || voice.samples.length === 0 || voiceAt === null) {
    return new AudioBuffer({ numberOfChannels: OUTPUT_CHANNELS, length, sampleRate: OUTPUT_SAMPLE_RATE })
  }
  const ctx = new OfflineAudioContext(OUTPUT_CHANNELS, length, OUTPUT_SAMPLE_RATE)
  const line = ctx.createBuffer(1, voice.samples.length, voice.sampleRate)
  line.getChannelData(0).set(voice.samples)
  const node = ctx.createBufferSource()
  node.buffer = line
  node.connect(ctx.destination)
  node.start(voiceAt)
  return ctx.startRendering()
}

/**
 * The video's cover when it opens with a 冒頭カード: the card as it stands
 * just before we walk through (both lines typed, the 暖簾 closed), over line
 * 1's first frame, as a PNG for the burn's cover frames.
 */
export async function openingCoverPng(take: Blob, at: number, plan: OpeningCardPlan): Promise<Blob> {
  const background = await firstFrameOf(take, at)
  const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    const layout = layoutOpening(plan.text, OUTPUT_WIDTH, OUTPUT_HEIGHT, (t, font) => {
      ctx.font = font
      return ctx.measureText(t).width
    }, plan.ja)
    drawOpeningCard(ctx, background, layout, plan.timing, coverTimeOf(plan.timing))
    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    background.width = 0
    background.height = 0
  }
}
