import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // @ffmpeg/ffmpeg loads its worker via `new Worker(new URL('./worker.js', import.meta.url))`.
  // Vite's dev-server dependency pre-bundling rewrites that in a way that breaks the worker's
  // own relative URL resolution (the browser requests a nonexistent .vite/deps/worker.js),
  // hanging any FFmpeg call indefinitely. Excluding both packages from pre-bundling avoids the
  // rewrite; this only affects `npm run dev` — production builds (`npm run build`) are unaffected.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  // Mirror vercel.json's production headers so a COEP-related regression
  // (e.g. a module Worker script missing Cross-Origin-Resource-Policy) is
  // caught locally instead of only in production. Cross-Origin-Embedder-Policy:
  // require-corp blocks loading a module Worker's script — even a same-origin
  // one, per Chromium's implementation — unless that response also carries
  // Cross-Origin-Resource-Policy; both the ffmpeg.wasm worker and the Whisper
  // transcription worker (src/workers/whisperWorker.ts) hit this.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    passWithNoTests: true,
  },
})
