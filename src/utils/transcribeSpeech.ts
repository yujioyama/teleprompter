import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { SubtitleCue } from './subtitleCues'
import { decodeAudioTrack } from './webcodecs/audioTrack'
import { CancelledError, onAbort, throwIfCancelled } from './cancellation'
import type { WhisperResponse } from '../workers/whisperWorker'

/** One word as Whisper's word-level timestamps give it (text has a leading space). */
export interface WhisperWord {
  text: string
  timestamp: [number, number | null]
}

/** Where transcription is: fetching the model (first time only), then recognizing. */
export type WhisperProgress =
  | { phase: 'download'; ratio: number }
  | { phase: 'recognize'; tokens: number }

const WHISPER_SAMPLE_RATE = 16000

// A cue is cut before a word that would take it past MAX_CUE_CHARS (about
// two lines of the English subtitle), after a sentence ends, after a comma
// once it is already COMMA_BREAK_CHARS long, and wherever the speaker
// pauses for PAUSE_BREAK_S. Free talk runs on for a minute without a full
// stop, so the length cap is what keeps each cue readable, and short enough
// to leave room for its Japanese line.
const MAX_CUE_CHARS = 42
const COMMA_BREAK_CHARS = 24
const PAUSE_BREAK_S = 0.7
// A cue stays up through a gap shorter than this before the next one rather
// than blinking off between them.
const LINGER_S = 1
// Floor for a word Whisper gave no end time (audio cut off mid-word).
const MIN_WORD_S = 0.3

const SENTENCE_END = /[.?!]["')\]]*$/
const CLAUSE_END = /[,;:—–-]["')\]]*$/
// Non-speech markers Whisper emits on silence or noise, e.g. [BLANK_AUDIO].
const NON_SPEECH = /^[[(].*[\])]$/

/**
 * Group Whisper's timed words into short subtitle cues, each shown from its
 * first word until its last ends (or until the next cue, across a short
 * gap). Pure; see the constants above for where it cuts.
 */
export function cuesFromWhisperWords(words: WhisperWord[]): SubtitleCue[] {
  const groups: { text: string; start: number; end: number }[] = []
  let current: { text: string; start: number; end: number } | null = null

  for (const word of words) {
    const text = word.text.trim()
    if (!text || NON_SPEECH.test(text)) continue
    const [start, rawEnd] = word.timestamp
    const end = Math.max(rawEnd ?? start + MIN_WORD_S, start)

    if (current && (start - current.end >= PAUSE_BREAK_S || current.text.length + 1 + text.length > MAX_CUE_CHARS)) {
      groups.push(current)
      current = null
    }
    if (current) {
      current.text += ` ${text}`
      current.end = end
    } else {
      current = { text, start, end }
    }
    if (SENTENCE_END.test(text) || (CLAUSE_END.test(text) && current.text.length >= COMMA_BREAK_CHARS)) {
      groups.push(current)
      current = null
    }
  }
  if (current) groups.push(current)

  return groups.map((g, i) => {
    const next = groups[i + 1]
    let end = g.end
    if (next && next.start - end < LINGER_S) end = next.start
    return { id: `speech-${i}`, start: g.start, end: Math.max(end, g.start + MIN_WORD_S), en: g.text, ja: null }
  })
}

/**
 * The video's audio as mono PCM at Whisper's 16kHz. Reads just the audio
 * track's packets out of the blob rather than the whole file — a long
 * one-take video can be hundreds of MB, too much to load at once on a phone
 * (issue #12) — then resamples offline, which also mixes it down to mono.
 * Falls back to decodeAudioData where WebCodecs can't decode the audio.
 */
async function decodeToWhisperPcm(blob: Blob): Promise<Float32Array> {
  let audio: AudioBuffer
  try {
    audio = await decodeAudioTrackOf(blob)
  } catch (err) {
    console.warn('[transcribeSpeech] WebCodecs decode failed, falling back to decodeAudioData:', err)
    return decodeWithWebAudio(blob)
  }
  const length = Math.ceil(audio.duration * WHISPER_SAMPLE_RATE)
  const ctx = new OfflineAudioContext(1, length, WHISPER_SAMPLE_RATE)
  const source = ctx.createBufferSource()
  source.buffer = audio
  source.connect(ctx.destination)
  source.start()
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0)
}

async function decodeAudioTrackOf(blob: Blob): Promise<AudioBuffer> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) throw new Error('video has no audio track')
    if (!(await track.canDecode())) throw new Error(`cannot decode ${track.codec ?? 'unknown'} audio`)
    return await decodeAudioTrack(track)
  } finally {
    input.dispose()
  }
}

/**
 * `AudioContext({ sampleRate: 16000 })` resamples to 16kHz on its own while
 * decoding, straight out of an H.264/AAC video blob.
 */
async function decodeWithWebAudio(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioCtx = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE })
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer)
    if (decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0)
    }
    // Downmix to mono the same way ffmpeg's `-ac 1` does (matches
    // transformers.js's own load_audio downmixing), to avoid clipping.
    const left = decoded.getChannelData(0)
    const right = decoded.getChannelData(1)
    const SCALING_FACTOR = Math.SQRT2
    const mono = new Float32Array(left.length)
    for (let i = 0; i < left.length; i++) {
      mono[i] = (SCALING_FACTOR * (left[i] + right[i])) / 2
    }
    return mono
  } finally {
    await audioCtx.close()
  }
}

/**
 * Transcribe what was actually said in the video into short, timed English
 * cues, with on-device Whisper in a Web Worker (keeps model load and
 * inference off the main thread). The first run downloads the model, which
 * the browser then caches. Aborting `signal` stops the worker and rejects
 * with CancelledError.
 */
export async function transcribeSpeech(
  videoBlob: Blob,
  onProgress?: (progress: WhisperProgress) => void,
  signal?: AbortSignal,
): Promise<SubtitleCue[]> {
  throwIfCancelled(signal)
  const audioData = await decodeToWhisperPcm(videoBlob)
  throwIfCancelled(signal)

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/whisperWorker.ts', import.meta.url), {
      type: 'module',
    })
    const unregister = onAbort(signal, () => {
      cleanup()
      reject(new CancelledError())
    })

    function cleanup() {
      unregister()
      worker.terminate()
    }

    worker.onmessage = (e: MessageEvent<WhisperResponse>) => {
      const message = e.data
      if (message.type === 'progress') {
        onProgress?.(message.progress)
        return
      }
      cleanup()
      if (message.type === 'error') {
        reject(new Error(message.message))
      } else {
        resolve(cuesFromWhisperWords(message.words))
      }
    }
    worker.onerror = (err) => {
      cleanup()
      reject(new Error(err.message || 'Whisper worker failed'))
    }
    // Copied rather than transferred: the samples may be an AudioBuffer's
    // own channel data, which isn't ours to detach.
    worker.postMessage({ audioData })
  })
}
