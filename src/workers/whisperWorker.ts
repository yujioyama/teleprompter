import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

// Safari's multi-threaded WASM backend (SharedArrayBuffer + growable memory)
// reliably fails during model init with "no available backend found" / "out
// of memory" even for whisper-tiny, while Chrome handles it fine. Pinning to
// a single thread avoids that path entirely; the model is small enough that
// the throughput cost is negligible.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1
}

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en') as Promise<AutomaticSpeechRecognitionPipeline>
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

self.onmessage = async (e: MessageEvent<WhisperRequest>) => {
  try {
    const transcriber = await getTranscriber()
    const output = await transcriber(e.data.audioData, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    })
    const chunks = Array.isArray(output) ? output[0]?.chunks ?? [] : output.chunks ?? []
    self.postMessage({ type: 'done', chunks })
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
