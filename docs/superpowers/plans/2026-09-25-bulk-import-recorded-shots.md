# Bulk Import Recorded Shots from teleprompter-cam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the user records shots in the teleprompter-cam companion app and returns to the PWA, let them pick all the resulting camera-roll videos at once and have the app match each one to its shot (via the shot ID already embedded in the filename), save them, and automatically land on the "finish" screen when every shot is covered.

**Architecture:** Two new pure utility modules — `matchShotRecordings.ts` (filename → shot matching) and `processRecordedVideo.ts` (trim/remux orchestration, extracted out of `useRecorder.ts` with no behavior change) — are composed inside `RecordPage.tsx`'s camera-roll import handler to add a "bulk" code path alongside the existing single-file "legacy" path.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, fake-indexeddb for IndexedDB-backed tests.

## Global Constraints

- Test command: `npx vitest run <path>` for a single file, `npm test` for the full suite (equivalent to `vitest run`).
- Type-check command: `npx tsc -b` (per project convention, `tsc --noEmit -p .` checks nothing in this repo — always use `tsc -b`).
- Before running the full test suite, remove any leftover `.claude/worktrees/*` directories — vitest scans them and double-runs tests otherwise. (Not needed for single-file test runs during a task.)
- No changes to the teleprompter-cam (Swift/iOS) repository — the filename format it already writes (`TeleprompterCam-<sessionTag>-shot<paddedIndex>of<count>-<shot.id>.mov`) is treated as a fixed external contract.
- Shot IDs are always `crypto.randomUUID()` strings (see `src/hooks/useScripts.ts` / `src/pages/ScriptEditPage.tsx`) — match against the standard 8-4-4-4-12 hex UUID shape.
- Follow existing code style: no comments except where a non-obvious constraint needs explaining (this codebase's own convention, visible throughout `src/utils`).

---

### Task 1: Extract `processRecordedVideo` out of `useRecorder`

**Files:**
- Create: `src/utils/processRecordedVideo.ts`
- Create: `src/utils/processRecordedVideo.test.ts`
- Modify: `src/hooks/useRecorder.ts`

**Interfaces:**
- Produces (used by Task 3):
  - `export interface ShotTrimSettings { trimEnabled: boolean; trimPaddingStart: number; trimPaddingEnd: number; normalizeAudio: boolean }`
  - `export interface ProcessedVideo { blob: Blob; ok: boolean; error: string | null }`
  - `export function isRemuxableContainer(mimeType: string): boolean`
  - `export function inferMimeType(file: File): string`
  - `export async function processRecordedVideo(raw: Blob, mimeType: string, shotSettings: ShotTrimSettings): Promise<ProcessedVideo>`

This task is a pure refactor: `useRecorder.ts`'s existing `processFinishedBlob` behavior must not change. It currently:
1. If the mime type is mp4/quicktime, sets `state = 'remuxing'`, detects speech bounds when `shotSettings.trimEnabled`, remuxes via `remuxMp4`, and stores the result.
2. Otherwise (webm), passes the blob through unchanged.

- [ ] **Step 1: Write the failing test file**

Create `src/utils/processRecordedVideo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processRecordedVideo, isRemuxableContainer, inferMimeType } from './processRecordedVideo'
import { detectSpeechBounds } from './detectSpeechBounds'
import { remuxMp4 } from './remuxMp4'

vi.mock('./detectSpeechBounds', () => ({ detectSpeechBounds: vi.fn() }))
vi.mock('./remuxMp4', () => ({ remuxMp4: vi.fn() }))

const mockDetect = vi.mocked(detectSpeechBounds)
const mockRemux = vi.mocked(remuxMp4)

function makeBlob(content = 'x') {
  return new Blob([content], { type: 'video/mp4' })
}

beforeEach(() => {
  mockDetect.mockReset()
  mockRemux.mockReset()
})

describe('processRecordedVideo', () => {
  it('passes webm blobs through unchanged without calling detect/remux', async () => {
    const raw = makeBlob()
    const result = await processRecordedVideo(raw, 'video/webm', {
      trimEnabled: true,
      trimPaddingStart: 0.5,
      trimPaddingEnd: 0.8,
      normalizeAudio: true,
    })
    expect(result).toEqual({ blob: raw, ok: true, error: null })
    expect(mockDetect).not.toHaveBeenCalled()
    expect(mockRemux).not.toHaveBeenCalled()
  })

  it('detects speech bounds and remuxes when trimming is enabled for a remuxable container', async () => {
    const raw = makeBlob()
    const remuxed = makeBlob('remuxed')
    mockDetect.mockResolvedValue({ start: 1, end: 4 })
    mockRemux.mockResolvedValue({ blob: remuxed, ok: true })

    const result = await processRecordedVideo(raw, 'video/mp4', {
      trimEnabled: true,
      trimPaddingStart: 0.5,
      trimPaddingEnd: 0.8,
      normalizeAudio: true,
    })

    expect(mockDetect).toHaveBeenCalledWith(raw, 0.5, 0.8)
    expect(mockRemux).toHaveBeenCalledWith(raw, { trim: { start: 1, end: 4 }, normalize: true })
    expect(result).toEqual({ blob: remuxed, ok: true, error: null })
  })

  it('skips speech detection when trimming is disabled, remuxing without a trim', async () => {
    const raw = makeBlob()
    mockRemux.mockResolvedValue({ blob: raw, ok: true })

    await processRecordedVideo(raw, 'video/mp4', {
      trimEnabled: false,
      trimPaddingStart: 0.5,
      trimPaddingEnd: 0.8,
      normalizeAudio: false,
    })

    expect(mockDetect).not.toHaveBeenCalled()
    expect(mockRemux).toHaveBeenCalledWith(raw, { trim: undefined, normalize: false })
  })

  it('remuxes .mov (quicktime) blobs, falling back to no trim when speech bounds are null', async () => {
    const raw = makeBlob()
    mockDetect.mockResolvedValue(null)
    mockRemux.mockResolvedValue({ blob: raw, ok: true })

    await processRecordedVideo(raw, 'video/quicktime', {
      trimEnabled: true,
      trimPaddingStart: 0.2,
      trimPaddingEnd: 0.2,
      normalizeAudio: true,
    })

    expect(mockRemux).toHaveBeenCalledWith(raw, { trim: undefined, normalize: true })
  })

  it('surfaces a remux failure as ok:false with the error message', async () => {
    const raw = makeBlob()
    mockRemux.mockResolvedValue({ blob: raw, ok: false, error: 'boom' })

    const result = await processRecordedVideo(raw, 'video/mp4', {
      trimEnabled: false,
      trimPaddingStart: 0,
      trimPaddingEnd: 0,
      normalizeAudio: false,
    })

    expect(result).toEqual({ blob: raw, ok: false, error: 'boom' })
  })
})

describe('isRemuxableContainer', () => {
  it('treats mp4 and quicktime mime types as remuxable', () => {
    expect(isRemuxableContainer('video/mp4')).toBe(true)
    expect(isRemuxableContainer('video/quicktime')).toBe(true)
  })

  it('treats webm as not remuxable', () => {
    expect(isRemuxableContainer('video/webm')).toBe(false)
  })
})

describe('inferMimeType', () => {
  it('uses the File.type when present', () => {
    const file = new File(['x'], 'clip.mov', { type: 'video/quicktime' })
    expect(inferMimeType(file)).toBe('video/quicktime')
  })

  it('falls back to extension sniffing for .mov files with no type', () => {
    const file = new File(['x'], 'clip.mov', { type: '' })
    expect(inferMimeType(file)).toBe('video/quicktime')
  })

  it('falls back to extension sniffing for .mp4 files with no type', () => {
    const file = new File(['x'], 'clip.mp4', { type: '' })
    expect(inferMimeType(file)).toBe('video/mp4')
  })

  it('defaults to webm when neither type nor extension is known', () => {
    const file = new File(['x'], 'clip.xyz', { type: '' })
    expect(inferMimeType(file)).toBe('video/webm')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/processRecordedVideo.test.ts`
Expected: FAIL — `Failed to resolve import "./processRecordedVideo"` (the module doesn't exist yet).

- [ ] **Step 3: Create `processRecordedVideo.ts`**

Create `src/utils/processRecordedVideo.ts`:

```ts
import { remuxMp4 } from './remuxMp4'
import { detectSpeechBounds } from './detectSpeechBounds'

export interface ShotTrimSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
  normalizeAudio: boolean
}

export interface ProcessedVideo {
  blob: Blob
  ok: boolean
  error: string | null
}

// mov and mp4 are both the ISO base media container (ffmpeg's mov,mp4,m4a,3gp,3g2,mj2
// demuxer handles either identically), so a .mov clip imported from the camera roll
// (e.g. from the native Cinematic-capture companion app) is just as remuxable as mp4.
export function isRemuxableContainer(mimeType: string): boolean {
  return mimeType.includes('mp4') || mimeType.includes('quicktime')
}

export function inferMimeType(file: File): string {
  if (file.type) return file.type
  if (/\.mov$/i.test(file.name)) return 'video/quicktime'
  if (/\.mp4$/i.test(file.name)) return 'video/mp4'
  return 'video/webm'
}

// Remux to move the moov atom to the front (faststart) for editor compatibility.
// Also detects and trims leading/trailing silence in the same FFmpeg pass.
export async function processRecordedVideo(
  raw: Blob,
  mimeType: string,
  shotSettings: ShotTrimSettings,
): Promise<ProcessedVideo> {
  if (!isRemuxableContainer(mimeType)) {
    // webm: trimming not supported, silently ignored
    return { blob: raw, ok: true, error: null }
  }

  let trim = null
  if (shotSettings.trimEnabled) {
    trim = await detectSpeechBounds(raw, shotSettings.trimPaddingStart, shotSettings.trimPaddingEnd)
  }
  const result = await remuxMp4(raw, {
    trim: trim ?? undefined,
    normalize: shotSettings.normalizeAudio,
  })
  return { blob: result.blob, ok: result.ok, error: result.error ?? null }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/processRecordedVideo.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Rewire `useRecorder.ts` to use the extracted function**

Replace the entire contents of `src/hooks/useRecorder.ts` with:

```ts
import { useRef, useState, type RefObject } from 'react'
import { shareOrDownload as shareBlob } from '../utils/shareOrDownload'
import {
  processRecordedVideo,
  inferMimeType,
  isRemuxableContainer,
  type ShotTrimSettings,
} from '../utils/processRecordedVideo'

export type RecordState = 'idle' | 'recording' | 'stopped' | 'remuxing'

export type { ShotTrimSettings }

interface UseRecorderResult {
  state: RecordState
  remuxOk: boolean | null
  remuxError: string | null
  startRecording: (stream: MediaStream, shotSettings: ShotTrimSettings) => void
  stopRecording: () => void
  importFile: (file: File, shotSettings: ShotTrimSettings) => Promise<void>
  shareOrDownload: (filename: string) => Promise<boolean>
  reset: () => void
  blobRef: Readonly<RefObject<Blob | null>>
}

function getSupportedMimeType(): string {
  const types = ['video/mp4', 'video/webm;codecs=h264', 'video/webm']
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
}

export function useRecorder(): UseRecorderResult {
  const [state, setState] = useState<RecordState>('idle')
  const [remuxOk, setRemuxOk] = useState<boolean | null>(null)
  const [remuxError, setRemuxError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const mimeTypeRef = useRef<string>('')

  function startRecording(stream: MediaStream, shotSettings: ShotTrimSettings) {
    const mimeType = getSupportedMimeType()
    mimeTypeRef.current = mimeType
    chunksRef.current = []
    blobRef.current = null
    setRemuxOk(null)
    setRemuxError(null)

    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 256_000,
      // Explicit video bitrate cap: default iOS MediaRecorder can exceed 10 Mbps,
      // exhausting the encoder's internal buffer after ~10 s and stopping video early.
      // 2.5 Mbps gives excellent quality while keeping buffer usage well within limits.
      videoBitsPerSecond: 2_500_000,
    })
    recorderRef.current = recorder

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      const raw = new Blob(chunksRef.current, {
        type: mimeType || 'video/webm',
      })
      await processFinishedBlob(raw, mimeType, shotSettings)
    }

    // Flush data every second — prevents the iOS video encoder's internal buffer from
    // accumulating too much data and stopping video capture mid-recording.
    recorder.start(1000)
    setState('recording')
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }

  // Shared by both a just-finished MediaRecorder take and an imported camera-roll file,
  // so trim/normalize/remux behave identically regardless of where the video came from.
  async function processFinishedBlob(raw: Blob, mimeType: string, shotSettings: ShotTrimSettings) {
    const remuxable = isRemuxableContainer(mimeType)
    if (remuxable) {
      setState('remuxing')
    }

    const result = await processRecordedVideo(raw, mimeType, shotSettings)
    blobRef.current = result.blob
    if (remuxable) {
      // remuxMp4's output is always video/mp4, regardless of the input container.
      mimeTypeRef.current = 'video/mp4'
    }
    setRemuxOk(result.ok)
    setRemuxError(result.error)

    setState('stopped')
  }

  async function importFile(file: File, shotSettings: ShotTrimSettings) {
    if (state !== 'idle') return
    const mimeType = inferMimeType(file)
    mimeTypeRef.current = mimeType
    chunksRef.current = []
    blobRef.current = null
    setRemuxOk(null)
    setRemuxError(null)
    await processFinishedBlob(file, mimeType, shotSettings)
  }

  async function shareOrDownload(filename: string): Promise<boolean> {
    if (!blobRef.current) return false
    return shareBlob(blobRef.current, filename)
  }

  function reset() {
    blobRef.current = null
    chunksRef.current = []
    recorderRef.current = null
    setRemuxOk(null)
    setRemuxError(null)
    setState('idle')
  }

  return { state, remuxOk, remuxError, startRecording, stopRecording, importFile, shareOrDownload, reset, blobRef }
}
```

This deletes the now-relocated `isRemuxableContainer`, `inferMimeType`, and the local `ShotTrimSettings` interface (imported from `processRecordedVideo.ts` instead, and re-exported via `export type { ShotTrimSettings }` so nothing outside this file needs to change its import path), and removes the `remuxMp4`/`detectSpeechBounds` imports (no longer called directly here). `getSupportedMimeType`, `startRecording`, `stopRecording`, `importFile`, `shareOrDownload`, `reset`, `RecordState`, and `UseRecorderResult` are otherwise unchanged from the original file.

- [ ] **Step 6: Run the full test suite to verify nothing broke**

Run: `npx vitest run`
Expected: PASS — no regressions in any existing test file.

- [ ] **Step 7: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/utils/processRecordedVideo.ts src/utils/processRecordedVideo.test.ts src/hooks/useRecorder.ts
git commit -m "refactor: extract trim/remux orchestration into processRecordedVideo"
```

---

### Task 2: Filename-based shot matching (`matchShotRecordings`)

**Files:**
- Create: `src/utils/matchShotRecordings.ts`
- Create: `src/utils/matchShotRecordings.test.ts`

**Interfaces:**
- Consumes: `Shot` from `src/types.ts` (`{ id: string; text: string; ... }`)
- Produces (used by Task 3):
  - `export function extractShotId(filename: string): string | null`
  - `export type ImportResolution = { kind: 'legacy'; file: File } | { kind: 'bulk'; targets: { shot: Shot; file: File }[] } | { kind: 'error'; unmatchedFilenames: string[] }`
  - `export function resolveImportTargets(files: File[], shots: Shot[]): ImportResolution`

- [ ] **Step 1: Write the failing test file**

Create `src/utils/matchShotRecordings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractShotId, resolveImportTargets } from './matchShotRecordings'
import { Shot } from '../types'

const SHOT_1 = '11111111-1111-1111-1111-111111111111'
const SHOT_2 = '22222222-2222-2222-2222-222222222222'
const SHOT_3 = '33333333-3333-3333-3333-333333333333'

const shots: Shot[] = [
  { id: SHOT_1, text: 'ショット1' },
  { id: SHOT_2, text: 'ショット2' },
  { id: SHOT_3, text: 'ショット3' },
]

function file(name: string): File {
  return new File(['x'], name, { type: 'video/quicktime' })
}

describe('extractShotId', () => {
  it('extracts the UUID embedded before the extension by teleprompter-cam', () => {
    expect(extractShotId(`TeleprompterCam-abc123-shot1of3-${SHOT_1}.mov`)).toBe(SHOT_1)
  })

  it('returns null for a filename with no embedded UUID', () => {
    expect(extractShotId('IMG_1234.MOV')).toBeNull()
  })

  it('returns null when the trailing segment is not a full UUID', () => {
    expect(extractShotId('TeleprompterCam-abc-shot1of3-not-a-uuid.mov')).toBeNull()
  })
})

describe('resolveImportTargets', () => {
  it('resolves a single matching file as bulk (so a lone retake still auto-saves)', () => {
    const f = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const result = resolveImportTargets([f], shots)
    expect(result).toEqual({ kind: 'bulk', targets: [{ shot: shots[0], file: f }] })
  })

  it('resolves a single non-matching file as legacy', () => {
    const f = file('IMG_1234.MOV')
    const result = resolveImportTargets([f], shots)
    expect(result).toEqual({ kind: 'legacy', file: f })
  })

  it('resolves multiple matching files as bulk, regardless of selection order', () => {
    const f2 = file(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`)
    const f1 = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const result = resolveImportTargets([f2, f1], shots)
    expect(result.kind).toBe('bulk')
    if (result.kind !== 'bulk') throw new Error('expected bulk')
    expect(result.targets).toEqual(
      expect.arrayContaining([
        { shot: shots[0], file: f1 },
        { shot: shots[1], file: f2 },
      ])
    )
    expect(result.targets).toHaveLength(2)
  })

  it('resolves to error when one of several files does not match any shot', () => {
    const f1 = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const bad = file('IMG_9999.MOV')
    const result = resolveImportTargets([f1, bad], shots)
    expect(result).toEqual({ kind: 'error', unmatchedFilenames: ['IMG_9999.MOV'] })
  })

  it('resolves to error when a matched file belongs to a shot id outside this script', () => {
    const foreign = file('TeleprompterCam-abc-shot1of1-99999999-9999-9999-9999-999999999999.mov')
    const known = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const result = resolveImportTargets([known, foreign], shots)
    expect(result).toEqual({ kind: 'error', unmatchedFilenames: [foreign.name] })
  })

  it('lists every unmatched filename when more than one fails to match', () => {
    const bad1 = file('IMG_1.MOV')
    const bad2 = file('IMG_2.MOV')
    const result = resolveImportTargets([bad1, bad2], shots)
    expect(result).toEqual({ kind: 'error', unmatchedFilenames: ['IMG_1.MOV', 'IMG_2.MOV'] })
  })

  it('keeps only the last file when two files in the same batch match the same shot', () => {
    const first = file(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)
    const retake = file(`TeleprompterCam-xyz-shot1of3-${SHOT_1}.mov`)
    const other = file(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`)
    const result = resolveImportTargets([first, other, retake], shots)
    expect(result.kind).toBe('bulk')
    if (result.kind !== 'bulk') throw new Error('expected bulk')
    expect(result.targets).toHaveLength(2)
    expect(result.targets.find(t => t.shot.id === SHOT_1)?.file).toBe(retake)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/matchShotRecordings.test.ts`
Expected: FAIL — `Failed to resolve import "./matchShotRecordings"`.

- [ ] **Step 3: Implement `matchShotRecordings.ts`**

Create `src/utils/matchShotRecordings.ts`:

```ts
import { Shot } from '../types'

// teleprompter-cam names saved Photos assets like:
//   TeleprompterCam-<sessionTag>-shot<paddedIndex>of<count>-<shot.id>.mov
// where <shot.id> is a crypto.randomUUID() string. This pulls that UUID
// back out so a batch of camera-roll files can be matched to shots.
const SHOT_ID_PATTERN =
  /-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.[^./]+$/

export function extractShotId(filename: string): string | null {
  const match = SHOT_ID_PATTERN.exec(filename)
  return match ? match[1] : null
}

export type ImportResolution =
  | { kind: 'legacy'; file: File }
  | { kind: 'bulk'; targets: { shot: Shot; file: File }[] }
  | { kind: 'error'; unmatchedFilenames: string[] }

export function resolveImportTargets(files: File[], shots: Shot[]): ImportResolution {
  const byId = new Map(shots.map(shot => [shot.id, shot]))

  if (files.length === 1) {
    const id = extractShotId(files[0].name)
    const shot = id ? byId.get(id) : undefined
    if (!shot) {
      return { kind: 'legacy', file: files[0] }
    }
    return { kind: 'bulk', targets: [{ shot, file: files[0] }] }
  }

  const unmatchedFilenames: string[] = []
  const targetsByShotId = new Map<string, { shot: Shot; file: File }>()

  for (const file of files) {
    const id = extractShotId(file.name)
    const shot = id ? byId.get(id) : undefined
    if (!shot) {
      unmatchedFilenames.push(file.name)
      continue
    }
    // Last file for a given shot wins (e.g. a retake recorded twice in the same session).
    targetsByShotId.set(shot.id, { shot, file })
  }

  if (unmatchedFilenames.length > 0) {
    return { kind: 'error', unmatchedFilenames }
  }

  return { kind: 'bulk', targets: [...targetsByShotId.values()] }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/matchShotRecordings.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/matchShotRecordings.ts src/utils/matchShotRecordings.test.ts
git commit -m "feat: match camera-roll filenames back to shots by embedded shot id"
```

---

### Task 3: Wire bulk import into `RecordPage`

**Files:**
- Modify: `src/pages/RecordPage.tsx`
- Create: `src/pages/RecordPage.test.tsx`

**Interfaces:**
- Consumes:
  - `resolveImportTargets(files: File[], shots: Shot[]): ImportResolution` (Task 2)
  - `processRecordedVideo(raw: Blob, mimeType: string, shotSettings: ShotTrimSettings): Promise<ProcessedVideo>` and `inferMimeType(file: File): string` (Task 1)
  - `saveShotVideo(scriptId: string, shotId: string, blob: Blob): Promise<void>` and `listShotVideos(scriptId: string): Promise<StoredShotVideo[]>` (existing, `src/utils/shotVideoStore.ts`)

- [ ] **Step 1: Write the failing component test file**

Create `src/pages/RecordPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IDBFactory } from 'fake-indexeddb'
import RecordPage from './RecordPage'
import { Script } from '../types'

vi.mock('../utils/processRecordedVideo', async () => {
  const actual = await vi.importActual<typeof import('../utils/processRecordedVideo')>(
    '../utils/processRecordedVideo'
  )
  return {
    ...actual,
    processRecordedVideo: vi.fn(async (raw: Blob) => ({ blob: raw, ok: true, error: null })),
  }
})

const SHOT_1 = '11111111-1111-1111-1111-111111111111'
const SHOT_2 = '22222222-2222-2222-2222-222222222222'
const SHOT_3 = '33333333-3333-3333-3333-333333333333'

function seedScript(): Script {
  const script: Script = {
    id: 'script-1',
    title: 'テスト動画',
    shots: [
      { id: SHOT_1, text: 'ショット1' },
      { id: SHOT_2, text: 'ショット2' },
      { id: SHOT_3, text: 'ショット3' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
  return script
}

function videoFile(name: string) {
  return new File(['x'], name, { type: 'video/quicktime' })
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  fireEvent.change(input)
}

function renderRecordPage(scriptId: string) {
  render(
    <MemoryRouter initialEntries={[`/scripts/${scriptId}/record`]}>
      <Routes>
        <Route path="/scripts/:id/record" element={<RecordPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('RecordPage bulk import from teleprompter-cam', () => {
  it('imports every matching file and shows the finish screen once all shots are covered', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [
      videoFile(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`),
      videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`),
      videoFile(`TeleprompterCam-abc-shot3of3-${SHOT_3}.mov`),
    ])

    expect(await screen.findByText('撮影完了！')).toBeInTheDocument()
    expect(screen.getByText('🎬 動画を仕上げる')).toBeInTheDocument()
  })

  it('imports the matching subset and lands on the next shot missing a video', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)])

    await waitFor(() => {
      expect(screen.getByText('2 / 3 ≡')).toBeInTheDocument()
    })
  })

  it('shows an error and saves nothing when one of several files does not match any shot', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [
      videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`),
      videoFile('IMG_1234.MOV'),
    ])

    expect(
      await screen.findByText(/一致しないファイルがあります: IMG_1234\.MOV/)
    ).toBeInTheDocument()
    expect(screen.getByText('1 / 3 ≡')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/RecordPage.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: 録画した動画をインポート` (the input has no accessible label yet, and `handleImportFromCameraRoll` doesn't support multiple files).

- [ ] **Step 3: Update `RecordPage.tsx` imports**

At the top of `src/pages/RecordPage.tsx`, replace:

```ts
import { saveShotVideo } from '../utils/shotVideoStore'
```

with:

```ts
import { saveShotVideo, listShotVideos } from '../utils/shotVideoStore'
import { processRecordedVideo, inferMimeType, type ShotTrimSettings } from '../utils/processRecordedVideo'
import { resolveImportTargets } from '../utils/matchShotRecordings'
import { Shot } from '../types'
```

- [ ] **Step 4: Add bulk-import state**

Inside the `RecordPage` component, alongside the existing `useState` declarations (near `persistError`), add:

```ts
  const [bulkImportError, setBulkImportError] = useState<string | null>(null)
  const [bulkImportProgress, setBulkImportProgress] = useState<{ done: number; total: number } | null>(null)
```

- [ ] **Step 5: Replace `handleImportFromCameraRoll` and add `runBulkImport`**

Replace the existing `handleImportFromCameraRoll` function with:

```ts
  function handleImportFromCameraRoll(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same file(s)
    if (files.length === 0) return

    const resolution = resolveImportTargets(files, safeScript.shots)

    if (resolution.kind === 'legacy') {
      setBulkImportError(null)
      importFile(resolution.file, {
        trimEnabled: effectiveTrimEnabled,
        trimPaddingStart: effectiveTrimPaddingStart,
        trimPaddingEnd: effectiveTrimPaddingEnd,
        normalizeAudio: globalSettings.normalizeAudio,
      })
      return
    }

    if (resolution.kind === 'error') {
      setBulkImportError(`一致しないファイルがあります: ${resolution.unmatchedFilenames.join(', ')}`)
      return
    }

    runBulkImport(resolution.targets)
  }

  async function runBulkImport(targets: { shot: Shot; file: File }[]) {
    setBulkImportError(null)
    setBulkImportProgress({ done: 0, total: targets.length })
    const failedShotTexts: string[] = []

    for (let i = 0; i < targets.length; i++) {
      const { shot, file } = targets[i]
      try {
        const mimeType = inferMimeType(file)
        const shotSettings: ShotTrimSettings = {
          trimEnabled: shot.trimEnabled ?? globalSettings.trimEnabled,
          trimPaddingStart: shot.trimPaddingStart ?? globalSettings.trimPaddingStart,
          trimPaddingEnd: shot.trimPaddingEnd ?? globalSettings.trimPaddingEnd,
          normalizeAudio: globalSettings.normalizeAudio,
        }
        const processed = await processRecordedVideo(file, mimeType, shotSettings)
        if (!processed.ok) {
          failedShotTexts.push(shot.text)
          continue
        }
        await saveShotVideo(safeScript.id, shot.id, processed.blob)
      } catch (err) {
        console.error('Failed to import a recorded shot video', err)
        failedShotTexts.push(shot.text)
      }
      setBulkImportProgress({ done: i + 1, total: targets.length })
    }

    setBulkImportProgress(null)
    if (failedShotTexts.length > 0) {
      setBulkImportError(`保存できなかったショットがあります: ${failedShotTexts.join(', ')}`)
    }

    const stored = await listShotVideos(safeScript.id)
    const savedIds = new Set(stored.map(v => v.shotId))
    const nextIndex = safeScript.shots.findIndex(s => !savedIds.has(s.id))
    setShotIndex(nextIndex === -1 ? safeScript.shots.length : nextIndex)
  }
```

- [ ] **Step 6: Update the import button's `<input>` and add progress/error display**

Find this block (inside the `state === 'idle'` branch of the controls section):

```tsx
              <button
                className={styles.importBtn}
                onClick={() => importInputRef.current?.click()}
              >
                🖼 カメラロールからインポート
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="video/*"
                onChange={handleImportFromCameraRoll}
                className={styles.hiddenFileInput}
              />
```

Replace it with:

```tsx
              <button
                className={styles.importBtn}
                onClick={() => importInputRef.current?.click()}
              >
                🖼 カメラロールからインポート
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="video/*"
                multiple
                aria-label="録画した動画をインポート"
                onChange={handleImportFromCameraRoll}
                className={styles.hiddenFileInput}
              />
              {bulkImportProgress && (
                <div className={styles.remuxing}>
                  インポート中 ({bulkImportProgress.done}/{bulkImportProgress.total})...
                </div>
              )}
              {bulkImportError && (
                <p className={styles.persistError}>{bulkImportError}</p>
              )}
```

- [ ] **Step 7: Run the component test to verify it passes**

Run: `npx vitest run src/pages/RecordPage.test.tsx`
Expected: PASS (all 3 tests).

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 9: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 10: Manual smoke check (per this project's UI-change convention)**

Since this changes user-facing behavior, start the dev server and click through it once by hand before committing:

```bash
npm run dev
```

Open the app, create or open a script with a few shots, go to the record screen, and confirm the "🖼 カメラロールからインポート" button still opens a file picker (multi-select won't be exercisable without real teleprompter-cam-named files on a device, so this is just a sanity check that the button and picker still work and nothing crashed).

- [ ] **Step 11: Commit**

```bash
git add src/pages/RecordPage.tsx src/pages/RecordPage.test.tsx
git commit -m "feat: bulk-import recorded shots from the camera roll by matching filenames"
```

---

## Post-implementation note

Flag to the user before considering this fully done: the design's one open risk (see the spec's "実装で確認・注意すべき点") is whether iOS's Photos picker actually preserves the `originalFilename` that teleprompter-cam sets via `PHAssetResourceCreationOptions` when the file is later selected through `<input type="file">` in Safari. This can only be confirmed on a real device — record a shot with teleprompter-cam, then check the selected file's name in a quick throwaway `console.log(file.name)` (or just try the real flow end-to-end) before relying on this feature.
