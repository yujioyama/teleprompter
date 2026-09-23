import { SubtitleCue } from './subtitleCues'

interface WhisperChunk {
  text: string
  timestamp: [number, number | null]
}

const WHISPER_SAMPLE_RATE = 16000

/** Pure: map raw Whisper pipeline output chunks to SubtitleCue objects. */
export function cuesFromWhisperChunks(chunks: WhisperChunk[]): SubtitleCue[] {
  return chunks.map((chunk, i) => ({
    id: `cue-${i}`,
    start: chunk.timestamp[0],
    end: chunk.timestamp[1] ?? chunk.timestamp[0] + 2,
    en: chunk.text.trim(),
    ja: null,
  }))
}

/**
 * Decode an audio/video Blob into mono PCM samples at Whisper's expected
 * 16kHz sample rate.
 *
 * This must run on the main thread: `transformers.js`'s pipeline decodes a
 * URL/Blob input via the browser's `AudioContext`, which does not exist
 * inside a Web Worker (confirmed by manual testing — passing an object URL
 * straight to the worker throws "AudioContext is not available in your
 * environment"). Decoding here and transferring the raw samples avoids that
 * entirely.
 */
async function decodeToWhisperPcm(blob: Blob): Promise<Float32Array> {
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
 * Run on-device Whisper transcription in a Web Worker (keeps model load and
 * inference off the main thread). Resolves with timestamped English cues.
 */
export async function transcribeSpeech(audioBlob: Blob): Promise<SubtitleCue[]> {
  const audioData = await decodeToWhisperPcm(audioBlob)

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/whisperWorker.ts', import.meta.url), {
      type: 'module',
    })

    function cleanup() {
      worker.terminate()
    }

    worker.onmessage = (e: MessageEvent<{ type: 'done'; chunks: WhisperChunk[] } | { type: 'error'; message: string }>) => {
      cleanup()
      if (e.data.type === 'error') {
        reject(new Error(e.data.message))
      } else {
        resolve(cuesFromWhisperChunks(e.data.chunks))
      }
    }
    worker.onerror = (err) => {
      cleanup()
      reject(new Error(err.message || 'Whisper worker failed'))
    }
    worker.postMessage({ audioData }, [audioData.buffer])
  })
}
