import { env, pipeline, TextStreamer, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import type { WhisperProgress, WhisperWord } from '../utils/transcribeSpeech'

// Safari's multi-threaded WASM backend (SharedArrayBuffer + growable memory)
// reliably fails during model init with "no available backend found" / "out
// of memory" even for whisper-tiny, while Chrome handles it fine. Pinning to
// a single thread avoids that path entirely, at the cost of a slower
// transcription.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1
}

// base.en is the most accurate Whisper that still fits a phone: ~77MB at
// 8-bit (tiny.en is ~40MB and noticeably worse on accented English; small.en
// is ~250MB, too much memory and minutes of single-threaded WASM on an
// iPhone). The `_timestamped` export carries the cross-attentions needed for
// word-level timestamps, which let long free-talk takes be cut into short
// cues at the right moments.
const MODEL_ID = 'onnx-community/whisper-base.en_timestamped'

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function post(message: WhisperResponse) {
  self.postMessage(message)
}

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    // Bytes per model file, summed for one download percentage. Files that
    // come from the browser cache report nothing, so a cached model goes
    // straight to recognizing.
    const files = new Map<string, { loaded: number; total: number }>()
    transcriberPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'q8',
      progress_callback: info => {
        if (info.status !== 'progress') return
        files.set(info.file, { loaded: info.loaded, total: info.total })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        if (total > 0) post({ type: 'progress', progress: { phase: 'download', ratio: loaded / total } })
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>
    // A failed load (e.g. offline) shouldn't be remembered for the next try.
    transcriberPromise.catch(() => {
      transcriberPromise = null
    })
  }
  return transcriberPromise
}

interface WhisperRequest {
  // Mono PCM samples at the model's expected sample rate (16kHz). We receive
  // raw samples rather than a URL/Blob because `transformers.js` decodes
  // URLs via `AudioContext`, which does not exist inside a Worker — decoding
  // happens on the main thread in transcribeSpeech.ts instead.
  audioData: Float32Array
}

export type WhisperResponse =
  | { type: 'progress'; progress: WhisperProgress }
  | { type: 'done'; words: WhisperWord[] }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<WhisperRequest>) => {
  try {
    const transcriber = await getTranscriber()
    // How many tokens the decoder has produced so far. There's no reliable
    // total to make a percentage of, but it keeps moving while recognition
    // does, which is what the stall hint needs.
    let tokens = 0
    post({ type: 'progress', progress: { phase: 'recognize', tokens } })
    const output = await transcriber(e.data.audioData, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      streamer: new TextStreamer(transcriber.tokenizer, {
        // Otherwise it prints the decoded text to the console.
        callback_function: () => undefined,
        token_callback_function: () => {
          tokens++
          post({ type: 'progress', progress: { phase: 'recognize', tokens } })
        },
      }),
    })
    const words = (Array.isArray(output) ? output[0]?.chunks : output.chunks) ?? []
    post({ type: 'done', words })
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
