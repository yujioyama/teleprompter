import { AudioBufferSource, Quality, VideoSample, VideoSampleSource } from 'mediabunny'
import { createMp4Output, runOutput } from './audioTrack'
import { OUTPUT_CHANNELS, OUTPUT_FRAME_RATE, OUTPUT_HEIGHT, OUTPUT_SAMPLE_RATE, OUTPUT_WIDTH } from './support'
import { cardMistSamples, cardPopSamples, drawCardFrame, layoutCardText } from '../drawInsertCard'
import { CARD_VOICE_START_S, cardSecondsFor, isSpookyCard, wobblesOf, type CardBackground } from '../insertCard'

/**
 * A 挿入カード as a clip of its own: every frame drawn (the letters popping
 * in and wobbling), over silence with the pop at its start when `sound`
 * (and, on a spooky card, its mist: cardMistSamples).
 * With `voice` (挿入カードの声, mono, any rate), the voice is heard from
 * CARD_VOICE_START_S and the card lasts as long as it needs (cardSecondsFor).
 * It goes into the 結合 like a take, trimmed and normalized as one, so it
 * joins the shots by packet copy and everything after the 結合 (subtitles,
 * BGM, export) sees it as part of the video.
 */
export async function rawCardClipWebCodecs(
  text: string,
  background: CardBackground,
  image: (CanvasImageSource & { width: number; height: number }) | undefined,
  sound: boolean,
  voice?: { samples: Float32Array; sampleRate: number },
  ja?: string,
): Promise<Blob> {
  const seconds = cardSecondsFor(voice ? voice.samples.length / voice.sampleRate : undefined)
  const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  const layout = layoutCardText(text, OUTPUT_WIDTH, (t, font) => {
    ctx.font = font
    return ctx.measureText(t).width
  }, undefined, ja)
  const wobbles = wobblesOf(layout.letters.map(l => l.ch).join(''), seconds)
  const frames = Math.round(seconds * OUTPUT_FRAME_RATE)
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
    await audioSource.add(await cardAudio(sound, seconds, voice, isSpookyCard(background)))
    audioSource.close()
  })
  canvas.width = 0
  canvas.height = 0
  if (!buffer) throw new Error('could not encode the card')
  return new Blob([buffer], { type: 'video/mp4' })
}

/**
 * The card's sound: silence a little past its end (so a trim never finds it
 * short), the pop at 0 (with the mist under it on a spooky card), and the voice, when there is one, from CARD_VOICE_START_S.
 */
async function cardAudio(sound: boolean, seconds: number, voice: { samples: Float32Array; sampleRate: number } | undefined, spooky: boolean): Promise<AudioBuffer> {
  const length = Math.ceil((seconds + 0.1) * OUTPUT_SAMPLE_RATE)
  const audio = new AudioBuffer({ numberOfChannels: OUTPUT_CHANNELS, length, sampleRate: OUTPUT_SAMPLE_RATE })
  if (sound) {
    // A moment in, so the AAC priming the trim cuts doesn't take its attack.
    const at = Math.round(0.03 * OUTPUT_SAMPLE_RATE)
    const pop = cardPopSamples(OUTPUT_SAMPLE_RATE)
    const mist = spooky ? cardMistSamples(OUTPUT_SAMPLE_RATE, seconds - 0.03) : null
    for (let c = 0; c < OUTPUT_CHANNELS; c++) {
      const channel = audio.getChannelData(c)
      pop.forEach((v, i) => (channel[at + i] += v))
      mist?.forEach((v, i) => (channel[at + i] += v))
    }
  }
  if (voice && voice.samples.length > 0) {
    const heard = await voiceAt(voice, length)
    for (let c = 0; c < OUTPUT_CHANNELS; c++) {
      const channel = audio.getChannelData(c)
      for (let i = 0; i < length; i++) channel[i] += heard[i]
    }
  }
  return audio
}

/** The voice at the output's rate, starting CARD_VOICE_START_S into `length` samples. */
async function voiceAt(voice: { samples: Float32Array; sampleRate: number }, length: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, length, OUTPUT_SAMPLE_RATE)
  const line = ctx.createBuffer(1, voice.samples.length, voice.sampleRate)
  line.getChannelData(0).set(voice.samples)
  const node = ctx.createBufferSource()
  node.buffer = line
  node.connect(ctx.destination)
  node.start(CARD_VOICE_START_S)
  return (await ctx.startRendering()).getChannelData(0)
}
