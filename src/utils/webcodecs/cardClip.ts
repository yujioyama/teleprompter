import { AudioBufferSource, Quality, VideoSample, VideoSampleSource } from 'mediabunny'
import { createMp4Output, runOutput } from './audioTrack'
import { OUTPUT_CHANNELS, OUTPUT_FRAME_RATE, OUTPUT_HEIGHT, OUTPUT_SAMPLE_RATE, OUTPUT_WIDTH } from './support'
import { cardPopSamples, drawCardFrame, layoutCardText } from '../drawInsertCard'
import { CARD_SECONDS, wobblesOf, type CardBackground } from '../insertCard'

/**
 * A 挿入カード as a clip of its own: every frame drawn (the letters popping
 * in and wobbling), over silence with the pop at its start when `sound`.
 * It goes into the 結合 like a take, trimmed and normalized as one, so it
 * joins the shots by packet copy and everything after the 結合 (subtitles,
 * BGM, export) sees it as part of the video.
 */
export async function rawCardClipWebCodecs(
  text: string,
  background: CardBackground,
  image: (CanvasImageSource & { width: number; height: number }) | undefined,
  sound: boolean,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  const layout = layoutCardText(text, OUTPUT_WIDTH, (t, font) => {
    ctx.font = font
    return ctx.measureText(t).width
  })
  const wobbles = wobblesOf(layout.letters.map(l => l.ch).join(''))
  const frames = Math.round(CARD_SECONDS * OUTPUT_FRAME_RATE)
  const frameSeconds = 1 / OUTPUT_FRAME_RATE

  const videoSource = new VideoSampleSource({ codec: 'avc', quality: new Quality('very-high') })
  const audioSource = new AudioBufferSource({ codec: 'aac', quality: new Quality('high') })
  const output = createMp4Output()
  output.addVideoTrack(videoSource, { frameRate: OUTPUT_FRAME_RATE })
  output.addAudioTrack(audioSource)
  const buffer = await runOutput(output, async () => {
    for (let i = 0; i < frames; i++) {
      drawCardFrame(ctx, OUTPUT_WIDTH, OUTPUT_HEIGHT, layout, wobbles, i * frameSeconds, background, image)
      const sample = new VideoSample(canvas, { timestamp: i * frameSeconds, duration: frameSeconds })
      try {
        await videoSource.add(sample)
      } finally {
        sample.close()
      }
    }
    videoSource.close()
    await audioSource.add(cardAudio(sound))
    audioSource.close()
  })
  canvas.width = 0
  canvas.height = 0
  if (!buffer) throw new Error('could not encode the card')
  return new Blob([buffer], { type: 'video/mp4' })
}

/** The card's sound: silence a little past its end (so a trim never finds it short), the pop at 0. */
function cardAudio(sound: boolean): AudioBuffer {
  const length = Math.ceil((CARD_SECONDS + 0.1) * OUTPUT_SAMPLE_RATE)
  const audio = new AudioBuffer({ numberOfChannels: OUTPUT_CHANNELS, length, sampleRate: OUTPUT_SAMPLE_RATE })
  if (sound) {
    // A moment in, so the AAC priming the trim cuts doesn't take its attack.
    const pop = cardPopSamples(OUTPUT_SAMPLE_RATE)
    const at = Math.round(0.03 * OUTPUT_SAMPLE_RATE)
    for (let c = 0; c < OUTPUT_CHANNELS; c++) audio.copyToChannel(pop, c, at)
  }
  return audio
}
