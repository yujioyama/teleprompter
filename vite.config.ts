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
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    passWithNoTests: true,
  },
})
