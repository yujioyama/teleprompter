# Video Finalize — Phase B: English Captions, Claude Handoff, Bilingual Burn-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After combining shots into one video (Phase A), the user can auto-generate English subtitles on-device, copy a ready-made translation prompt to paste into Claude, paste the Japanese reply back in, and burn both languages into the video as visible captions — producing a second savable/shareable output, independent of Phase C's BGM step.

**Architecture:** A new `SubtitleWorkflow` component, mounted inside `FinalizePage` once a combine succeeds, owns its own state machine (generate → review English → hand off to Claude → apply Japanese → choose position → burn in → save). English transcription runs entirely on-device via `@huggingface/transformers`' Whisper pipeline inside a Web Worker (keeping model load and inference off the main thread). Burn-in renders each subtitle as a canvas-drawn PNG (bilingual, bold JA above smaller EN) and composites them onto the video via FFmpeg's `overlay` filter with per-cue time windows — this sidesteps needing CJK font/libass support in the FFmpeg WASM build, and gives full control over bilingual typography.

**Tech Stack:** React 18 + TypeScript, `@huggingface/transformers` (new dependency, Whisper WASM inference), `@ffmpeg/ffmpeg` (already used, for audio extraction and the overlay burn-in), Canvas 2D API (subtitle image rendering), Web Worker (transcription).

## Global Constraints

- No new backend/server — everything stays client-side (see `docs/superpowers/specs/2026-09-23-video-finalize-design.md`).
- Follow existing code style: no semicolons, single quotes, 2-space indent, CSS Modules per component.
- **Type-check with `npx tsc -b`, never `npx tsc --noEmit -p .`.** This repo's `tsconfig.json` is a solution-style config (`files: []`, only `references`); in non-build mode, `-p .` silently checks nothing. `npm run build` runs `tsc -b`, and that is the only command that actually verifies types here — a Phase A task's false-negative type-check broke the Vercel deploy after merge (see `docs/superpowers/specs/...` history / git log `bc7b750`).
- FFmpeg-call-heavy code (things that call `ff.exec(...)`) is verified manually via the dev server, not unit-tested, matching Phase A's established convention — extract and unit-test the pure, non-FFmpeg logic around it instead. The same applies to Worker-based Whisper inference: the worker/message-passing plumbing is manually verified; the pure data-shaping logic around it (`cuesFromWhisperChunks`) is unit-tested.
- Reuse `SubtitleCue` (defined in Task 1) everywhere a cue is passed between files — do not redefine it.
- The combined video from Phase A is always 1080×1920 (the fixed output profile of `trimAndNormalizeShot`) — position math can rely on this fixed height rather than probing it.
- **Watch for the same class of Vite dev-server bug Phase A hit** (`@ffmpeg/ffmpeg`'s internal Worker broke under esbuild dependency pre-bundling, fixed via `optimizeDeps.exclude` in `vite.config.ts`). `@huggingface/transformers` also loads WASM (via `onnxruntime-web`) and may have its own worker/dynamic-import patterns that Vite's pre-bundler mishandles. If a task's manual verification hits a hang or a 404 for a `.vite/deps/...` file, diagnose it the same way (see `vite.config.ts`'s existing comment) and add to `optimizeDeps.exclude` rather than treating it as a mystery failure.

---

### Task 1: `subtitleCues.ts` — cue type, Claude prompt builder, paste-back parser

**Files:**
- Create: `src/utils/subtitleCues.ts`
- Test: `src/utils/subtitleCues.test.ts`

**Interfaces:**
- Produces: `SubtitleCue { id: string; start: number; end: number; en: string; ja: string | null }`, `buildClaudePrompt(cues: SubtitleCue[]): string`, `parseJapanesePaste(text: string, cues: SubtitleCue[]): { ok: true; cues: SubtitleCue[] } | { ok: false; error: string }`. Used by Task 3 (cue construction), Task 5 (`SubtitleEditor`), Task 7 (`SubtitleWorkflow`).

- [ ] **Step 1: Write the failing tests**

Create `src/utils/subtitleCues.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildClaudePrompt, parseJapanesePaste, type SubtitleCue } from './subtitleCues'

function makeCues(en: string[]): SubtitleCue[] {
  return en.map((text, i) => ({ id: `cue-${i}`, start: i, end: i + 1, en: text, ja: null }))
}

describe('buildClaudePrompt', () => {
  it('numbers cues 1-indexed in order and includes the translation instructions', () => {
    const prompt = buildClaudePrompt(makeCues(['Hello there', 'This is a test']))
    expect(prompt).toContain('1. Hello there')
    expect(prompt).toContain('2. This is a test')
    expect(prompt).toContain('番号はそのまま保持')
  })

  it('handles a single cue', () => {
    const prompt = buildClaudePrompt(makeCues(['Only one line']))
    expect(prompt).toContain('1. Only one line')
    expect(prompt).not.toContain('2.')
  })
})

describe('parseJapanesePaste', () => {
  it('matches numbered lines back onto cues by position', () => {
    const cues = makeCues(['Hello', 'World'])
    const result = parseJapanesePaste('1. こんにちは\n2. 世界', cues)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cues[0].ja).toBe('こんにちは')
      expect(result.cues[1].ja).toBe('世界')
      // English and timing are preserved unchanged
      expect(result.cues[0].en).toBe('Hello')
      expect(result.cues[0].start).toBe(0)
    }
  })

  it('tolerates extra whitespace and blank lines between entries', () => {
    const cues = makeCues(['Hello', 'World'])
    const result = parseJapanesePaste('  1.   こんにちは  \n\n2.世界\n', cues)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cues[0].ja).toBe('こんにちは')
      expect(result.cues[1].ja).toBe('世界')
    }
  })

  it('fails with a listed missing number when a line is absent', () => {
    const cues = makeCues(['Hello', 'World', 'Third'])
    const result = parseJapanesePaste('1. こんにちは\n3. 三番目', cues)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('2')
    }
  })

  it('fails with a listed extra number when an out-of-range line is present', () => {
    const cues = makeCues(['Hello'])
    const result = parseJapanesePaste('1. こんにちは\n2. 余分', cues)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('2')
    }
  })

  it('ignores non-numbered lines (e.g. a preamble the user forgot to strip)', () => {
    const cues = makeCues(['Hello', 'World'])
    const result = parseJapanesePaste('わかりました！\n1. こんにちは\n2. 世界', cues)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cues[0].ja).toBe('こんにちは')
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- subtitleCues`
Expected: FAIL — `Cannot find module './subtitleCues'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/subtitleCues.ts`:

```ts
export interface SubtitleCue {
  id: string
  start: number
  end: number
  en: string
  ja: string | null
}

export function buildClaudePrompt(cues: SubtitleCue[]): string {
  const lines = cues.map((cue, i) => `${i + 1}. ${cue.en}`).join('\n')
  return `以下の英語字幕を、自然な話し言葉の日本語字幕に翻訳してください。
- 番号はそのまま保持してください
- 意訳して構いませんが、短く自然な字幕にしてください
- 出力は「番号. 日本語訳」の形式のみとし、前置きや説明は不要です

${lines}`
}

interface ParseSuccess {
  ok: true
  cues: SubtitleCue[]
}

interface ParseFailure {
  ok: false
  error: string
}

const NUMBERED_LINE = /^\s*(\d+)\.\s*(.+?)\s*$/

export function parseJapanesePaste(text: string, cues: SubtitleCue[]): ParseSuccess | ParseFailure {
  const map = new Map<number, string>()
  for (const rawLine of text.split('\n')) {
    const m = NUMBERED_LINE.exec(rawLine)
    if (!m) continue
    map.set(parseInt(m[1], 10), m[2])
  }

  const missing: number[] = []
  for (let i = 1; i <= cues.length; i++) {
    if (!map.has(i)) missing.push(i)
  }
  const extra = [...map.keys()].filter(n => n < 1 || n > cues.length)

  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = []
    if (missing.length > 0) parts.push(`不足: ${missing.join(', ')}`)
    if (extra.length > 0) parts.push(`余分: ${extra.join(', ')}`)
    return {
      ok: false,
      error: `行数が一致しません（${parts.join(' / ')}）。番号を保ったまま貼り直してください。`,
    }
  }

  return {
    ok: true,
    cues: cues.map((cue, i) => ({ ...cue, ja: map.get(i + 1)! })),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- subtitleCues`
Expected: PASS (7 tests)

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: no output (clean)

- [ ] **Step 6: Commit**

```bash
git add src/utils/subtitleCues.ts src/utils/subtitleCues.test.ts
git commit -m "feat: add SubtitleCue type, Claude prompt builder, and paste-back parser"
```

---

### Task 2: `extractAudioForTranscription` — pull a clean WAV out of the combined video

Whisper transcription needs decoded audio, not a video container. This extracts a 16kHz mono WAV via FFmpeg — the format transformers.js's audio pipeline expects.

**Files:**
- Create: `src/utils/extractAudioForTranscription.ts`

**Interfaces:**
- Produces: `extractAudioForTranscription(videoBlob: Blob): Promise<Blob>` (audio/wav). Used by Task 7 (`SubtitleWorkflow`).

No test file for this task: the FFmpeg args here are a fixed, unparameterized array (`-i in.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le out.wav`) with no branching or computed values — there is no meaningful logic to separate out and unit-test (a test would just assert the array equals itself). This is a deliberate, narrow exception to the "extract and test the pure part" convention, made explicit here rather than silently skipped.

- [ ] **Step 1: Write the implementation**

Create `src/utils/extractAudioForTranscription.ts`:

```ts
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null
let loaded = false

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) ffmpeg = new FFmpeg()
  if (!loaded) {
    const origin = window.location.origin
    await ffmpeg.load({
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
    })
    loaded = true
  }
  return ffmpeg
}

/**
 * Extract a 16kHz mono PCM WAV from a video blob's audio track — the format
 * transformers.js's Whisper pipeline expects when fed a URL/Blob directly.
 */
export async function extractAudioForTranscription(videoBlob: Blob): Promise<Blob> {
  const ff = await getFFmpeg()
  await ff.writeFile('in.mp4', await fetchFile(videoBlob))
  await ff.exec(['-i', 'in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'out.wav'])
  const data = await ff.readFile('out.wav')
  ff.deleteFile('in.mp4')
  ff.deleteFile('out.wav')
  return new Blob([data as Uint8Array], { type: 'audio/wav' })
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no output (clean)

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: PASS (all existing tests, no new ones from this task)

- [ ] **Step 4: Commit**

```bash
git add src/utils/extractAudioForTranscription.ts
git commit -m "feat: add extractAudioForTranscription for Whisper input"
```

---

### Task 3: Whisper transcription — worker, dependency, and cue construction

**Files:**
- Create: `src/workers/whisperWorker.ts`
- Create: `src/utils/transcribeSpeech.ts`
- Test: `src/utils/transcribeSpeech.test.ts`
- Modify: `package.json` (add `@huggingface/transformers`)

**Interfaces:**
- Consumes: `SubtitleCue` from Task 1.
- Produces: `cuesFromWhisperChunks(chunks: WhisperChunk[]): SubtitleCue[]` (pure, tested), `transcribeSpeech(audioBlob: Blob): Promise<SubtitleCue[]>` (worker-based, manually verified). Used by Task 7 (`SubtitleWorkflow`).

- [ ] **Step 1: Add the dependency**

```bash
npm install @huggingface/transformers
```

- [ ] **Step 2: Write the failing test for the pure chunk-mapping function**

Create `src/utils/transcribeSpeech.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cuesFromWhisperChunks } from './transcribeSpeech'

describe('cuesFromWhisperChunks', () => {
  it('maps each chunk to a cue with start/end from the timestamp tuple', () => {
    const cues = cuesFromWhisperChunks([
      { text: ' Hello there', timestamp: [0, 1.5] },
      { text: ' This is a test', timestamp: [1.5, 3.2] },
    ])
    expect(cues).toHaveLength(2)
    expect(cues[0]).toMatchObject({ start: 0, end: 1.5, en: 'Hello there', ja: null })
    expect(cues[1]).toMatchObject({ start: 1.5, end: 3.2, en: 'This is a test', ja: null })
  })

  it('trims leading/trailing whitespace Whisper commonly emits around words', () => {
    const cues = cuesFromWhisperChunks([{ text: '  Hello   ', timestamp: [0, 1] }])
    expect(cues[0].en).toBe('Hello')
  })

  it('falls back to start + 2s when the final chunk has a null end timestamp', () => {
    // Whisper's chunking can leave the last segment's end timestamp null
    // when the audio cuts off mid-word.
    const cues = cuesFromWhisperChunks([{ text: 'Cut off', timestamp: [10, null] }])
    expect(cues[0].start).toBe(10)
    expect(cues[0].end).toBe(12)
  })

  it('assigns stable, unique ids in order', () => {
    const cues = cuesFromWhisperChunks([
      { text: 'a', timestamp: [0, 1] },
      { text: 'b', timestamp: [1, 2] },
    ])
    expect(cues[0].id).not.toBe(cues[1].id)
  })

  it('returns an empty array for empty input', () => {
    expect(cuesFromWhisperChunks([])).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- transcribeSpeech`
Expected: FAIL — `Cannot find module './transcribeSpeech'`

- [ ] **Step 4: Write the worker**

Create `src/workers/whisperWorker.ts`:

```ts
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en') as Promise<AutomaticSpeechRecognitionPipeline>
  }
  return transcriberPromise
}

interface WhisperRequest {
  audioUrl: string
}

self.onmessage = async (e: MessageEvent<WhisperRequest>) => {
  try {
    const transcriber = await getTranscriber()
    const output = await transcriber(e.data.audioUrl, {
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
```

- [ ] **Step 5: Write `transcribeSpeech.ts`**

Create `src/utils/transcribeSpeech.ts`:

```ts
import { SubtitleCue } from './subtitleCues'

interface WhisperChunk {
  text: string
  timestamp: [number, number | null]
}

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
 * Run on-device Whisper transcription in a Web Worker (keeps model load and
 * inference off the main thread). Resolves with timestamped English cues.
 */
export function transcribeSpeech(audioBlob: Blob): Promise<SubtitleCue[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/whisperWorker.ts', import.meta.url), {
      type: 'module',
    })
    const audioUrl = URL.createObjectURL(audioBlob)

    function cleanup() {
      URL.revokeObjectURL(audioUrl)
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
    worker.postMessage({ audioUrl })
  })
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- transcribeSpeech`
Expected: PASS (5 tests)

- [ ] **Step 7: Type-check**

Run: `npx tsc -b`
Expected: no output (clean). If `@huggingface/transformers`'s types don't export `AutomaticSpeechRecognitionPipeline` under that exact name, adjust the import to whatever the installed version actually exports (check `node_modules/@huggingface/transformers/types/**` or the package's own `.d.ts` for the correct pipeline return type name) — do not use `any` to paper over it.

- [ ] **Step 8: Manually verify the worker actually transcribes real audio**

This is the first point where on-device Whisper actually runs, and per the Global Constraints, it may hit the same class of Vite pre-bundling issue `@ffmpeg/ffmpeg` did:

1. Start the dev server (`npm run dev`), open the browser console.
2. In the console, synthesize a short WAV and run transcription directly:
   ```js
   const ctx = new AudioContext()
   const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate) // 2s silence is fine for a smoke test
   // (silence will transcribe to an empty/near-empty result — that's OK, the goal here is confirming the pipeline loads and runs without hanging or erroring)
   ```
   Since scripting a full WAV encode from the console is tedious, simpler: temporarily add a button to `FinalizePage` (or call `transcribeSpeech` from the console against a `File` picked via `<input type=file>`) using any short local audio/video file with speech, and confirm it resolves with non-empty `SubtitleCue[]` within a reasonable time (tiny model, short clip: well under a minute on a modern machine). Remove any temporary test wiring before committing.
3. If it hangs or errors with a `.vite/deps/...` 404 (the same symptom Phase A's `@ffmpeg/ffmpeg` bug produced), add `@huggingface/transformers` to `vite.config.ts`'s existing `optimizeDeps.exclude` array and re-verify.
4. If you cannot perform this manual check in your sandbox, say so plainly in your report — do not skip straight past it without attempting it.

- [ ] **Step 9: Commit**

```bash
git add src/workers/whisperWorker.ts src/utils/transcribeSpeech.ts src/utils/transcribeSpeech.test.ts package.json package-lock.json
git commit -m "feat: add on-device Whisper transcription via a Web Worker"
```

(If Step 8 required a `vite.config.ts` change, include it in this commit and say so in the commit message, mirroring how Phase A handled its own Vite fix.)

---

### Task 4: `subtitlePosition.ts` — vertical placement math

**Files:**
- Create: `src/utils/subtitlePosition.ts`
- Test: `src/utils/subtitlePosition.test.ts`

**Interfaces:**
- Produces: `SubtitlePosition = 'top' | 'center' | 'bottom'`, `subtitleY(position: SubtitlePosition, videoHeight: number, overlayHeight: number): number`. Used by Task 6 (`burnSubtitles`) and Task 7 (`SubtitleWorkflow`'s position picker).

- [ ] **Step 1: Write the failing tests**

Create `src/utils/subtitlePosition.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { subtitleY } from './subtitlePosition'

describe('subtitleY', () => {
  it('places top position near the top of the frame', () => {
    expect(subtitleY('top', 1920, 200)).toBe(154) // round(1920 * 0.08)
  })

  it('centers the overlay vertically for center position', () => {
    expect(subtitleY('center', 1920, 200)).toBe(860) // round((1920 - 200) / 2)
  })

  it('places bottom position near the bottom, above the overlay height', () => {
    expect(subtitleY('bottom', 1920, 200)).toBe(1298) // round(1920 * 0.78 - 200)
  })

  it('scales with a different video height', () => {
    expect(subtitleY('top', 1000, 100)).toBe(80)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- subtitlePosition`
Expected: FAIL — `Cannot find module './subtitlePosition'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/subtitlePosition.ts`:

```ts
export type SubtitlePosition = 'top' | 'center' | 'bottom'

/** Pure: compute the overlay's Y coordinate for a given vertical position choice. */
export function subtitleY(position: SubtitlePosition, videoHeight: number, overlayHeight: number): number {
  switch (position) {
    case 'top':
      return Math.round(videoHeight * 0.08)
    case 'center':
      return Math.round((videoHeight - overlayHeight) / 2)
    case 'bottom':
      return Math.round(videoHeight * 0.78 - overlayHeight)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- subtitlePosition`
Expected: PASS (4 tests)

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: no output (clean)

- [ ] **Step 6: Commit**

```bash
git add src/utils/subtitlePosition.ts src/utils/subtitlePosition.test.ts
git commit -m "feat: add subtitleY pure helper for vertical caption placement"
```

---

### Task 5: `SubtitleEditor` — editable bilingual cue list

**Files:**
- Create: `src/components/SubtitleEditor.tsx`, `src/components/SubtitleEditor.module.css`

**Interfaces:**
- Consumes: `SubtitleCue` from Task 1.
- Produces: `<SubtitleEditor cues={cues} onEditEn={(id, text) => ...} onEditJa={(id, text) => ...} />`. Used by Task 7 (`SubtitleWorkflow`), for both the English-only review step and the bilingual review step after Japanese is applied.

No automated test — this is a small, presentational, form-driven component (text inputs + callbacks), verified manually, consistent with this repo's convention for interactive UI (`ShotTrimmer`, `ShotCard` also have no component tests).

- [ ] **Step 1: Write the component**

Create `src/components/SubtitleEditor.module.css`:

```css
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  background: var(--surface2);
  border-radius: 8px;
  padding: 8px 10px;
}

.num {
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-bottom: 4px;
}

.time {
  color: var(--text-muted);
  font-size: 0.7rem;
  margin-left: 6px;
}

.field {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 6px 8px;
  font-size: 0.85rem;
  margin-top: 4px;
}

.fieldJa {
  font-weight: 700;
}
```

Create `src/components/SubtitleEditor.tsx`:

```tsx
import { SubtitleCue } from '../utils/subtitleCues'
import styles from './SubtitleEditor.module.css'

interface SubtitleEditorProps {
  cues: SubtitleCue[]
  onEditEn: (id: string, text: string) => void
  onEditJa: (id: string, text: string) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

export default function SubtitleEditor({ cues, onEditEn, onEditJa }: SubtitleEditorProps) {
  return (
    <div className={styles.list}>
      {cues.map((cue, i) => (
        <div key={cue.id} className={styles.row}>
          <div className={styles.num}>
            {i + 1}
            <span className={styles.time}>{formatTime(cue.start)} - {formatTime(cue.end)}</span>
          </div>
          <input
            className={styles.field}
            value={cue.en}
            onChange={e => onEditEn(cue.id, e.target.value)}
            aria-label={`英語字幕 ${i + 1}`}
          />
          {cue.ja !== null && (
            <input
              className={`${styles.field} ${styles.fieldJa}`}
              value={cue.ja}
              onChange={e => onEditJa(cue.id, e.target.value)}
              aria-label={`日本語字幕 ${i + 1}`}
            />
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Manually verify in the dev server**

Since `SubtitleWorkflow` (Task 7) doesn't exist yet, verify this in isolation: temporarily render `<SubtitleEditor cues={sampleCues} onEditEn={console.log} onEditJa={console.log} />` in `FinalizePage.tsx` with a few hand-written `SubtitleCue` objects (some with `ja: null`, some with `ja` set), confirm the English field is always editable, the Japanese field only appears when `ja !== null`, and typing in either field logs the right `(id, text)`. Revert the temporary wiring — Task 7 does this for real.

- [ ] **Step 3: Run the full test suite and type-check**

Run: `npm run test` (expect no regressions) and `npx tsc -b` (expect clean)

- [ ] **Step 4: Commit**

```bash
git add src/components/SubtitleEditor.tsx src/components/SubtitleEditor.module.css
git commit -m "feat: add SubtitleEditor for editable bilingual cue review"
```

---

### Task 6: `burnSubtitles` — render bilingual overlays and composite them onto the video

**Files:**
- Create: `src/utils/burnSubtitles.ts`
- Test: `src/utils/burnSubtitles.test.ts`

**Interfaces:**
- Consumes: `SubtitleCue` from Task 1, `SubtitlePosition`/`subtitleY` from Task 4.
- Produces: `buildOverlayFilterGraph(cueCount: number, y: number): { filterGraph: string; inputLabel: string; outputLabel: string }` (pure, tested), `renderCueImage(cue: SubtitleCue, videoWidth: number): Promise<Blob>` (canvas rendering, manually verified), `burnSubtitles(videoBlob: Blob, cues: SubtitleCue[], position: SubtitlePosition): Promise<Blob>` (FFmpeg, manually verified). Used by Task 7 (`SubtitleWorkflow`).

- [ ] **Step 1: Write the failing test for the pure filter-graph builder**

Create `src/utils/burnSubtitles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildOverlayFilterGraph } from './burnSubtitles'

describe('buildOverlayFilterGraph', () => {
  it('chains one overlay per cue, each reading the previous stage\'s output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph(3, 1500)
    expect(filterGraph).toContain('[0:v][sub0]overlay')
    expect(filterGraph).toContain('[v0][sub1]overlay')
    expect(filterGraph).toContain('[v1][sub2]overlay')
    expect(outputLabel).toBe('[v2]')
  })

  it('uses the given Y coordinate and centers horizontally for every cue', () => {
    const { filterGraph } = buildOverlayFilterGraph(1, 300)
    expect(filterGraph).toContain('x=(W-w)/2:y=300')
  })

  it('produces a single overlay stage for one cue', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph(1, 100)
    expect(filterGraph).toBe('[0:v][sub0]overlay=x=(W-w)/2:y=100[v0]')
    expect(outputLabel).toBe('[v0]')
  })

  it('handles zero cues by returning an empty filter graph with the base video as output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph(0, 100)
    expect(filterGraph).toBe('')
    expect(outputLabel).toBe('[0:v]')
  })
})
```

Note on design: this function only builds the *structural* chain — which input feeds which stage, and the fixed X/Y position. Per-cue visibility timing is NOT expressed here via an `enable=` clause; instead, each overlay PNG's input is itself time-bounded via `-loop 1 -t <duration>` and `-ss <start>` at the ffmpeg-input level (see Step 3's `burnSubtitles`), which is simpler to get right with per-image bounded-duration inputs than threading a time-window expression through the filter string.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- burnSubtitles`
Expected: FAIL — `Cannot find module './burnSubtitles'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/burnSubtitles.ts`:

```ts
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { SubtitleCue } from './subtitleCues'
import { SubtitlePosition, subtitleY } from './subtitlePosition'

let ffmpeg: FFmpeg | null = null
let loaded = false

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) ffmpeg = new FFmpeg()
  if (!loaded) {
    const origin = window.location.origin
    await ffmpeg.load({
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
    })
    loaded = true
  }
  return ffmpeg
}

/**
 * Build the chained overlay filtergraph for `cueCount` subtitle image inputs
 * (indices 1..cueCount, input 0 is the base video), each composited at the
 * same fixed (horizontally centered, given Y) position. Each image input is
 * itself time-bounded via `-loop 1 -t <duration>` and a `-ss <start>` offset
 * at the ffmpeg-input level (see burnSubtitles below), so no `enable=`
 * time-window expression is needed here — simpler and less error-prone than
 * threading per-cue timing through the filter string itself.
 */
export function buildOverlayFilterGraph(
  cueCount: number,
  y: number,
): { filterGraph: string; outputLabel: string } {
  if (cueCount === 0) {
    return { filterGraph: '', outputLabel: '[0:v]' }
  }

  const stages: string[] = []
  for (let i = 0; i < cueCount; i++) {
    const baseInput = i === 0 ? '[0:v]' : `[v${i - 1}]`
    const outputLabel = `[v${i}]`
    stages.push(`${baseInput}[sub${i}]overlay=x=(W-w)/2:y=${y}${outputLabel}`)
  }

  return { filterGraph: stages.join(';'), outputLabel: `[v${cueCount - 1}]` }
}

/**
 * Render one cue's bilingual subtitle (Japanese bold/larger above, English
 * smaller below, on a semi-transparent rounded background) as a transparent
 * PNG sized to the video width.
 */
export async function renderCueImage(cue: SubtitleCue, videoWidth: number): Promise<Blob> {
  const height = 220
  const canvas = document.createElement('canvas')
  canvas.width = videoWidth
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  ctx.clearRect(0, 0, videoWidth, height)

  const padding = 24
  const boxTop = 20
  const boxHeight = height - 40
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  const radius = 16
  ctx.beginPath()
  ctx.roundRect(padding, boxTop, videoWidth - padding * 2, boxHeight, radius)
  ctx.fill()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'

  ctx.font = 'bold 52px sans-serif'
  ctx.fillText(cue.ja ?? '', videoWidth / 2, boxTop + 70, videoWidth - padding * 4)

  ctx.font = '34px sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.fillText(cue.en, videoWidth / 2, boxTop + 130, videoWidth - padding * 4)

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to render subtitle image'))
    }, 'image/png')
  })
}

const VIDEO_WIDTH = 1080
const VIDEO_HEIGHT = 1920
const OVERLAY_HEIGHT = 220

/**
 * Burn bilingual subtitles into the video: render one PNG per cue with a
 * `ja` translation, feed each in as a time-bounded image input, and
 * composite them via a chained overlay filtergraph.
 */
export async function burnSubtitles(
  videoBlob: Blob,
  cues: SubtitleCue[],
  position: SubtitlePosition,
): Promise<Blob> {
  const translated = cues.filter(c => c.ja !== null)
  if (translated.length === 0) {
    // Nothing to burn in — return the video unchanged.
    return videoBlob
  }

  const ff = await getFFmpeg()
  await ff.writeFile('in.mp4', await fetchFile(videoBlob))

  const args: string[] = ['-i', 'in.mp4']
  for (let i = 0; i < translated.length; i++) {
    const cue = translated[i]
    const imageBlob = await renderCueImage(cue, VIDEO_WIDTH)
    const name = `sub${i}.png`
    await ff.writeFile(name, await fetchFile(imageBlob))
    const duration = Math.max(0.1, cue.end - cue.start)
    args.push('-loop', '1', '-ss', cue.start.toFixed(3), '-t', duration.toFixed(3), '-i', name)
  }

  const y = subtitleY(position, VIDEO_HEIGHT, OVERLAY_HEIGHT)
  const { filterGraph, outputLabel } = buildOverlayFilterGraph(translated.length, y)

  args.push(
    '-filter_complex', filterGraph,
    '-map', outputLabel,
    '-map', '0:a',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'copy',
    '-shortest',
    '-movflags', '+faststart',
    'out.mp4',
  )

  await ff.exec(args)
  const data = await ff.readFile('out.mp4')

  ff.deleteFile('in.mp4')
  for (let i = 0; i < translated.length; i++) ff.deleteFile(`sub${i}.png`)
  ff.deleteFile('out.mp4')

  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- burnSubtitles`
Expected: PASS (4 tests)

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: clean. If `ctx.roundRect` isn't recognized by the TypeScript DOM lib version in use, replace it with an explicit path-based rounded rectangle (four `arcTo` calls or a manual `moveTo`/`lineTo`/`quadraticCurveTo` sequence) rather than casting to `any` — check `npx tsc -b`'s exact error first.

- [ ] **Step 6: Manually verify rendering and burn-in**

1. Temporarily call `renderCueImage({ id: 'x', start: 0, end: 2, en: 'Hello there', ja: 'こんにちは' }, 1080)` from the dev console (or a temporary button in `FinalizePage`) and download/display the resulting PNG blob — confirm Japanese renders correctly (no tofu boxes / missing glyphs — the OS's default sans-serif should have CJK coverage on both macOS and iOS Safari, but verify), text fits within the rounded box, and the box is semi-transparent over a busy background.
2. Using a short combined test video (from Phase A's manual verification approach — synthetic clips are fine) and 2-3 hand-written cues with both `en` and `ja` set, call `burnSubtitles(videoBlob, cues, 'bottom')` and confirm the output plays with the correct bilingual captions appearing only during each cue's time window, disappearing between cues, positioned near the bottom.
3. Try `'top'` and `'center'` too, confirming the Y position visibly changes.
4. Remove any temporary test wiring before committing.

- [ ] **Step 7: Commit**

```bash
git add src/utils/burnSubtitles.ts src/utils/burnSubtitles.test.ts
git commit -m "feat: add burnSubtitles with a pure, tested overlay filtergraph builder"
```

---

### Task 7: `SubtitleWorkflow` — wire generate → Claude handoff → burn-in end to end

**Files:**
- Create: `src/components/SubtitleWorkflow.tsx`, `src/components/SubtitleWorkflow.module.css`

**Interfaces:**
- Consumes: `SubtitleCue`, `buildClaudePrompt`, `parseJapanesePaste` (Task 1); `extractAudioForTranscription` (Task 2); `transcribeSpeech` (Task 3); `SubtitlePosition` (Task 4); `SubtitleEditor` (Task 5); `burnSubtitles` (Task 6); `shareOrDownload` (already exists from Phase A, `src/utils/shareOrDownload.ts`).
- Produces: `<SubtitleWorkflow combinedBlob={blob} filenameBase={string} />`. Used by Task 8 (`FinalizePage` wiring).

- [ ] **Step 1: Write the component**

Create `src/components/SubtitleWorkflow.module.css`:

```css
.wrapper {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.genBtn {
  background: var(--accent);
  color: #fff;
  padding: 14px 32px;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 700;
}

.genBtn:disabled {
  opacity: 0.5;
}

.section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sectionTitle {
  font-weight: 700;
  font-size: 0.95rem;
}

.copyBtn {
  align-self: flex-start;
  background: var(--surface2);
  color: var(--text);
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 0.85rem;
}

.pasteArea {
  width: 100%;
  min-height: 120px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 8px;
  font-size: 0.85rem;
}

.positionRow {
  display: flex;
  gap: 8px;
}

.positionBtn {
  flex: 1;
  background: var(--surface2);
  color: var(--text);
  padding: 8px;
  border-radius: 8px;
  font-size: 0.85rem;
}

.positionBtnActive {
  background: var(--accent);
  color: #fff;
}

.error {
  color: var(--danger);
  font-size: 0.85rem;
}

.preview {
  width: 100%;
  border-radius: 8px;
  background: #000;
}
```

Create `src/components/SubtitleWorkflow.tsx`:

```tsx
import { useState } from 'react'
import { SubtitleCue, buildClaudePrompt, parseJapanesePaste } from '../utils/subtitleCues'
import { extractAudioForTranscription } from '../utils/extractAudioForTranscription'
import { transcribeSpeech } from '../utils/transcribeSpeech'
import { burnSubtitles } from '../utils/burnSubtitles'
import { SubtitlePosition } from '../utils/subtitlePosition'
import { shareOrDownload } from '../utils/shareOrDownload'
import SubtitleEditor from './SubtitleEditor'
import styles from './SubtitleWorkflow.module.css'

interface SubtitleWorkflowProps {
  combinedBlob: Blob
  filenameBase: string
}

type Stage = 'idle' | 'transcribing' | 'reviewing' | 'burning' | 'done' | 'error'

export default function SubtitleWorkflow({ combinedBlob, filenameBase }: SubtitleWorkflowProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [position, setPosition] = useState<SubtitlePosition>('bottom')
  const [burnedUrl, setBurnedUrl] = useState<string | null>(null)
  const [burnedBlob, setBurnedBlob] = useState<Blob | null>(null)

  async function handleGenerate() {
    setStage('transcribing')
    setErrorMessage(null)
    try {
      const audio = await extractAudioForTranscription(combinedBlob)
      const generated = await transcribeSpeech(audio)
      setCues(generated)
      setStage('reviewing')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  function handleEditEn(id: string, text: string) {
    setCues(prev => prev.map(c => (c.id === id ? { ...c, en: text } : c)))
  }

  function handleEditJa(id: string, text: string) {
    setCues(prev => prev.map(c => (c.id === id ? { ...c, ja: text } : c)))
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(buildClaudePrompt(cues))
  }

  function handleApplyPaste() {
    const result = parseJapanesePaste(pasteText, cues)
    if (!result.ok) {
      setPasteError(result.error)
      return
    }
    setPasteError(null)
    setCues(result.cues)
  }

  async function handleBurnIn() {
    setStage('burning')
    setErrorMessage(null)
    try {
      const burned = await burnSubtitles(combinedBlob, cues, position)
      setBurnedBlob(burned)
      setBurnedUrl(URL.createObjectURL(burned))
      setStage('done')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  async function handleSaveBurned() {
    if (!burnedBlob) return
    await shareOrDownload(burnedBlob, `${filenameBase}-subtitled`)
  }

  const hasAnyJapanese = cues.some(c => c.ja !== null)
  const allTranslated = cues.length > 0 && cues.every(c => c.ja !== null && c.ja.trim() !== '')

  return (
    <div className={styles.wrapper}>
      {stage === 'idle' && (
        <button className={styles.genBtn} onClick={handleGenerate}>
          🎤 英語字幕を生成
        </button>
      )}

      {stage === 'transcribing' && (
        <p className={styles.sectionTitle}>字幕を生成中...（初回はモデルのダウンロードが入ります）</p>
      )}

      {(stage === 'reviewing' || stage === 'burning' || stage === 'done') && cues.length > 0 && (
        <>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>英語字幕（必要なら修正してください）</p>
            <SubtitleEditor cues={cues} onEditEn={handleEditEn} onEditJa={handleEditJa} />
          </div>

          {!hasAnyJapanese && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Claudeで日本語訳を作成</p>
              <button className={styles.copyBtn} onClick={handleCopyPrompt}>
                📋 Claude用プロンプトをコピー
              </button>
              <textarea
                className={styles.pasteArea}
                placeholder="Claudeからの返信をここに貼り付け"
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
              />
              <button className={styles.copyBtn} onClick={handleApplyPaste}>
                日本語を反映
              </button>
              {pasteError && <p className={styles.error}>{pasteError}</p>}
            </div>
          )}

          {hasAnyJapanese && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>字幕の位置</p>
              <div className={styles.positionRow}>
                {(['top', 'center', 'bottom'] as const).map(p => (
                  <button
                    key={p}
                    className={`${styles.positionBtn} ${position === p ? styles.positionBtnActive : ''}`}
                    onClick={() => setPosition(p)}
                  >
                    {p === 'top' ? '上部' : p === 'center' ? '中央' : '下部'}
                  </button>
                ))}
              </div>
              <button
                className={styles.genBtn}
                onClick={handleBurnIn}
                disabled={!allTranslated || stage === 'burning'}
              >
                {stage === 'burning' ? '焼き込み中...' : '字幕を焼き込む'}
              </button>
            </div>
          )}
        </>
      )}

      {stage === 'error' && errorMessage && (
        <p className={styles.error}>エラーが発生しました: {errorMessage}</p>
      )}

      {stage === 'done' && burnedUrl && (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>字幕付き動画</p>
          <video className={styles.preview} src={burnedUrl} controls playsInline />
          <button className={styles.genBtn} onClick={handleSaveBurned}>
            保存する
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Manually verify the full subtitle workflow end to end**

Using a short combined test video with real spoken English audio (per Task 3's manual verification, or a fresh short recording), run through the whole flow in the dev server:

1. Click "🎤 英語字幕を生成", confirm cues appear after transcription completes with plausible timestamps and text.
2. Edit an English line, confirm it updates.
3. Click "📋 Claude用プロンプトをコピー", paste the clipboard contents somewhere to confirm it's the expected instruction + numbered English lines format.
4. Paste a hand-written numbered Japanese translation (matching the exact cue count) into the textarea, click "日本語を反映", confirm each cue now shows an editable Japanese field with the right text.
5. Try pasting a deliberately wrong-count Japanese response, confirm the error message appears and cues are NOT overwritten.
6. Re-paste a correct one, pick a position, click "字幕を焼き込む", confirm the burned-in video preview shows bilingual captions timed correctly.
7. Click "保存する", confirm the share sheet/download triggers with a filename like `<title>-subtitled.mp4`.

If any step can't be driven from your sandbox (e.g. no real microphone/spoken-audio source available), substitute a pre-existing short video file with speech and say in your report exactly what was and wasn't verified.

- [ ] **Step 3: Run the full test suite and type-check**

Run: `npm run test` (expect no regressions) and `npx tsc -b` (expect clean)

- [ ] **Step 4: Commit**

```bash
git add src/components/SubtitleWorkflow.tsx src/components/SubtitleWorkflow.module.css
git commit -m "feat: wire subtitle generation, Claude handoff, and burn-in into SubtitleWorkflow"
```

---

### Task 8: Mount `SubtitleWorkflow` in `FinalizePage`

**Files:**
- Modify: `src/pages/FinalizePage.tsx`

**Interfaces:**
- Consumes: `SubtitleWorkflow` from Task 7.

- [ ] **Step 1: Add the import and render it after a successful combine**

In `src/pages/FinalizePage.tsx`, add the import:

```ts
import SubtitleWorkflow from '../components/SubtitleWorkflow'
```

Inside the `combineState === 'done' && combinedUrl && (...)` block (currently renders the "結合結果" preview + save button), add `SubtitleWorkflow` right after the existing save button, still inside the same conditional:

```tsx
          {combineState === 'done' && combinedUrl && (
            <div className={styles.shotEntry}>
              <p className={styles.shotEntryText}>結合結果</p>
              <video className={styles.preview} src={combinedUrl} controls playsInline />
              <button className={styles.finalizeBtn} onClick={handleSaveCombined}>
                保存する
              </button>
              {combinedBlob && (
                <SubtitleWorkflow combinedBlob={combinedBlob} filenameBase={`${script.title}-combined`} />
              )}
            </div>
          )}
```

(`combinedBlob` is already in scope as existing component state — this is a minimal addition, not a restructure.)

- [ ] **Step 2: Manually verify in the dev server**

Complete a combine (per Phase A's flow), confirm the "🎤 英語字幕を生成" button now appears below the existing "保存する" button, and that the full Task 7 flow works when reached this way (not just in isolation).

- [ ] **Step 3: Run the full test suite and type-check**

Run: `npm run test` (expect no regressions) and `npx tsc -b` (expect clean)

- [ ] **Step 4: Commit**

```bash
git add src/pages/FinalizePage.tsx
git commit -m "feat: mount SubtitleWorkflow after a successful combine in FinalizePage"
```

---

## Self-Review Notes

- **Spec coverage:** Covers the design doc's Step 2 (English captions) and Step 3 (Claude handoff) in full, plus the bilingual burn-in portion of Step 5 that the earlier phase-split conversation assigned to Phase B ("Phase B: 英語字幕の自動生成 → Claude連携 → 日本語字幕の焼き込み"). BGM mixing and the final combined-with-music export remain Phase C, deliberately excluded here — Phase B already produces an independently useful, savable output (a subtitled video) without them.
- **Type consistency:** `SubtitleCue` is defined once (Task 1) and imported everywhere else (Tasks 3, 5, 6, 7) rather than redeclared. `SubtitlePosition`/`subtitleY` similarly defined once (Task 4) and consumed by Tasks 6 and 7.
- **No placeholders:** every step has complete, runnable code. The one deliberately-skipped pure/tested split (`extractAudioForTranscription`'s fixed FFmpeg args) is explicitly justified rather than silently omitted, matching how Phase A's own review process treated similar calls.
- **Known risk carried over from Phase A:** the Global Constraints section calls out that `@huggingface/transformers` may hit the same Vite dev-server pre-bundling issue `@ffmpeg/ffmpeg` did; Task 3's manual verification step explicitly checks for and knows how to diagnose/fix this, rather than assuming it will just work.
- **Verification command corrected:** every task uses `npx tsc -b`, not `npx tsc --noEmit -p .` — the latter was the root cause of Phase A's post-merge Vercel deploy failure (a false "clean" result from a command that silently checks nothing against this repo's solution-style `tsconfig.json`).
