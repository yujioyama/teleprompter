# Video Finalize — Phase A: Persist, Trim & Combine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After recording all shots for a script, the user can open a new "仕上げ" (Finalize) screen, fine-trim each shot's start/end point, combine them into a single video, and save/share that combined video — with no subtitles or music yet (those are Phase B and C).

**Architecture:** Persist each shot's already-processed video Blob to IndexedDB right when the user saves it in `RecordPage`. A new `FinalizePage`, reached from the "撮影完了" screen, loads the stored blobs in script order, lets the user adjust trim bounds per shot with a draggable timeline, then runs two FFmpeg passes per clip (re-encode-at-trim-bounds, then concat-demuxer) to produce one combined MP4, which goes out through the same share/download pattern already used for individual shots.

**Tech Stack:** React 18 + TypeScript, `@ffmpeg/ffmpeg` (WASM, already a dependency), native `indexedDB` (no new runtime dependency), Vitest + `fake-indexeddb` for tests.

## Global Constraints

- No new backend/server — everything stays client-side, consistent with this being a static PWA (see `docs/superpowers/specs/2026-09-23-video-finalize-design.md`).
- Follow existing code style: no semicolons, single quotes, 2-space indent, CSS Modules per page/component (see any existing `src/pages/*.tsx` + `*.module.css` pair).
- FFmpeg-call-heavy code (things that call `ff.exec(...)`) is verified manually via the dev server, not unit-tested — this matches the existing convention in this repo, where `src/utils/remuxMp4.ts` and `src/utils/detectSpeechBounds.ts` (both FFmpeg/Web-Audio-heavy) have no test files, while pure logic (`src/utils/mergeShots.ts`, `src/utils/splitShots.ts`) is fully unit-tested. Extract the pure, non-FFmpeg logic out of each FFmpeg wrapper and unit-test *that*.
- Reuse the existing `Shot`/`Script` types from `src/types.ts` — do not redefine them.

---

### Task 1: Extract `shareOrDownload` into a standalone util

Today, saving/sharing a finished clip lives entirely inside `useRecorder.ts`, coupled to its own `blobRef`. Phase A's combine step needs the exact same "share via Web Share API, fall back to download" behavior for a *combined* video that has nothing to do with the recorder hook. Extract it so both call sites can use it.

**Files:**
- Create: `src/utils/shareOrDownload.ts`
- Test: `src/utils/shareOrDownload.test.ts`
- Modify: `src/hooks/useRecorder.ts:26-33` (remove local `getExtension`), `src/hooks/useRecorder.ts:139-167` (delegate to the new util)

**Interfaces:**
- Produces: `shareOrDownload(blob: Blob, filenameBase: string): Promise<boolean>` — `true` if shared or downloaded, `false` only when the user cancelled the native share sheet. Used by Task 9 (combine step export) and by the refactored `useRecorder.shareOrDownload`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/shareOrDownload.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shareOrDownload } from './shareOrDownload'

function makeBlob(type = 'video/mp4') {
  return new Blob(['fake-video-data'], { type })
}

describe('shareOrDownload', () => {
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error test-only cleanup of a property we stub per test
    delete navigator.canShare
    // @ts-expect-error test-only cleanup of a property we stub per test
    delete navigator.share
  })

  it('shares the file with a .mp4 extension when canShare/share succeed', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true })

    const result = await shareOrDownload(makeBlob('video/mp4'), 'my-shot')

    expect(result).toBe(true)
    expect(shareMock).toHaveBeenCalledTimes(1)
    const [{ files, title }] = shareMock.mock.calls[0]
    expect(title).toBe('my-shot.mp4')
    expect(files[0].name).toBe('my-shot.mp4')
  })

  it('returns false without downloading when the user cancels the share sheet', async () => {
    const abortError = new DOMException('cancelled', 'AbortError')
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(abortError),
      configurable: true,
    })

    const result = await shareOrDownload(makeBlob(), 'my-shot')

    expect(result).toBe(false)
    expect(createObjectURLSpy).not.toHaveBeenCalled()
  })

  it('falls back to a download link with a .webm extension when canShare is unavailable', async () => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const result = await shareOrDownload(makeBlob('video/webm'), 'my-shot')

    expect(result).toBe(true)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(createObjectURLSpy).toHaveBeenCalledWith(expect.any(Blob))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- shareOrDownload`
Expected: FAIL — `Cannot find module './shareOrDownload'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/shareOrDownload.ts`:

```ts
function getExtension(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

/**
 * Share a finished video via the Web Share API (saves to camera roll on iOS
 * Safari 15+), falling back to a plain download when sharing isn't
 * available. Returns false only when the user explicitly cancelled the
 * native share sheet, so callers can distinguish "cancelled" from "saved".
 */
export async function shareOrDownload(blob: Blob, filenameBase: string): Promise<boolean> {
  const ext = getExtension(blob.type)
  const fullName = `${filenameBase}.${ext}`
  const file = new File([blob], fullName, { type: blob.type || 'video/webm' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fullName })
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false
      // Non-AbortError: share API failed for other reason — fall through to download fallback
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fullName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- shareOrDownload`
Expected: PASS (3 tests)

- [ ] **Step 5: Delegate `useRecorder`'s `shareOrDownload` to the new util**

In `src/hooks/useRecorder.ts`:

1. Remove the module-level `getExtension` function (lines 31-33) — it's no longer used here.
2. Add the import: `import { shareOrDownload as shareBlob } from '../utils/shareOrDownload'`
3. Replace the existing `shareOrDownload` function body (lines 139-167) with:

```ts
  async function shareOrDownload(filename: string): Promise<boolean> {
    if (!blobRef.current) return false
    return shareBlob(blobRef.current, filename)
  }
```

- [ ] **Step 6: Run the full test suite to confirm nothing broke**

Run: `npm run test`
Expected: PASS (all existing tests + the 3 new ones)

- [ ] **Step 7: Commit**

```bash
git add src/utils/shareOrDownload.ts src/utils/shareOrDownload.test.ts src/hooks/useRecorder.ts
git commit -m "refactor: extract shareOrDownload into a standalone util"
```

---

### Task 2: `shotVideoStore` — IndexedDB persistence for processed shot videos

**Files:**
- Create: `src/utils/shotVideoStore.ts`
- Test: `src/utils/shotVideoStore.test.ts`
- Modify: `package.json` (add `fake-indexeddb` dev dependency)

**Interfaces:**
- Produces: `StoredShotVideo { scriptId: string; shotId: string; blob: Blob; updatedAt: string }`, `saveShotVideo(scriptId, shotId, blob): Promise<void>`, `getShotVideo(scriptId, shotId): Promise<Blob | null>`, `listShotVideos(scriptId): Promise<StoredShotVideo[]>`, `deleteShotVideo(scriptId, shotId): Promise<void>`, `clearShotVideos(scriptId): Promise<void>`. Used by Task 3 (`RecordPage`) and Task 4 (`FinalizePage`), and later by Phase C's post-export cleanup.

- [ ] **Step 1: Add the test dependency**

```bash
npm install --save-dev fake-indexeddb
```

- [ ] **Step 2: Write the failing tests**

Create `src/utils/shotVideoStore.test.ts`:

```ts
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveShotVideo,
  getShotVideo,
  listShotVideos,
  deleteShotVideo,
  clearShotVideos,
} from './shotVideoStore'

function makeBlob(content: string) {
  return new Blob([content], { type: 'video/mp4' })
}

beforeEach(() => {
  // Fresh in-memory IndexedDB for every test so state doesn't leak between them
  globalThis.indexedDB = new IDBFactory()
})

describe('shotVideoStore', () => {
  it('returns null for a shot that was never saved', async () => {
    expect(await getShotVideo('script-1', 'shot-1')).toBeNull()
  })

  it('saves and retrieves a shot video by scriptId + shotId', async () => {
    await saveShotVideo('script-1', 'shot-1', makeBlob('a'))
    const blob = await getShotVideo('script-1', 'shot-1')
    expect(blob).not.toBeNull()
    expect(await blob!.text()).toBe('a')
  })

  it('overwrites the existing entry on a retake (same scriptId + shotId)', async () => {
    await saveShotVideo('script-1', 'shot-1', makeBlob('first-take'))
    await saveShotVideo('script-1', 'shot-1', makeBlob('second-take'))
    const blob = await getShotVideo('script-1', 'shot-1')
    expect(await blob!.text()).toBe('second-take')
  })

  it('lists only the videos belonging to the given script, in no particular order', async () => {
    await saveShotVideo('script-1', 'shot-a', makeBlob('a'))
    await saveShotVideo('script-1', 'shot-b', makeBlob('b'))
    await saveShotVideo('script-2', 'shot-c', makeBlob('c'))

    const list = await listShotVideos('script-1')
    expect(list).toHaveLength(2)
    expect(list.map(v => v.shotId).sort()).toEqual(['shot-a', 'shot-b'])
  })

  it('deletes a single shot video without affecting others', async () => {
    await saveShotVideo('script-1', 'shot-a', makeBlob('a'))
    await saveShotVideo('script-1', 'shot-b', makeBlob('b'))

    await deleteShotVideo('script-1', 'shot-a')

    expect(await getShotVideo('script-1', 'shot-a')).toBeNull()
    expect(await getShotVideo('script-1', 'shot-b')).not.toBeNull()
  })

  it('clears every stored video for a script, leaving other scripts untouched', async () => {
    await saveShotVideo('script-1', 'shot-a', makeBlob('a'))
    await saveShotVideo('script-1', 'shot-b', makeBlob('b'))
    await saveShotVideo('script-2', 'shot-c', makeBlob('c'))

    await clearShotVideos('script-1')

    expect(await listShotVideos('script-1')).toHaveLength(0)
    expect(await listShotVideos('script-2')).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- shotVideoStore`
Expected: FAIL — `Cannot find module './shotVideoStore'`

- [ ] **Step 4: Write the implementation**

Create `src/utils/shotVideoStore.ts`:

```ts
const DB_NAME = 'teleprompter-shot-videos'
const DB_VERSION = 1
const STORE_NAME = 'shotVideos'

export interface StoredShotVideo {
  scriptId: string
  shotId: string
  blob: Blob
  updatedAt: string
}

function makeKey(scriptId: string, shotId: string): string {
  return `${scriptId}::${shotId}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('byScript', 'scriptId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveShotVideo(scriptId: string, shotId: string, blob: Blob): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({
      key: makeKey(scriptId, shotId),
      scriptId,
      shotId,
      blob,
      updatedAt: new Date().toISOString(),
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getShotVideo(scriptId: string, shotId: string): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(makeKey(scriptId, shotId))
    req.onsuccess = () => resolve(req.result ? (req.result as StoredShotVideo).blob : null)
    req.onerror = () => reject(req.error)
  })
}

export async function listShotVideos(scriptId: string): Promise<StoredShotVideo[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.objectStore(STORE_NAME).index('byScript')
    const req = index.getAll(scriptId)
    req.onsuccess = () => resolve(req.result as StoredShotVideo[])
    req.onerror = () => reject(req.error)
  })
}

export async function deleteShotVideo(scriptId: string, shotId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(makeKey(scriptId, shotId))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearShotVideos(scriptId: string): Promise<void> {
  const videos = await listShotVideos(scriptId)
  await Promise.all(videos.map(v => deleteShotVideo(v.scriptId, v.shotId)))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- shotVideoStore`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add src/utils/shotVideoStore.ts src/utils/shotVideoStore.test.ts package.json package-lock.json
git commit -m "feat: add IndexedDB-backed shotVideoStore for processed shot videos"
```

---

### Task 3: Persist each shot's video on save, from `RecordPage`

**Files:**
- Modify: `src/pages/RecordPage.tsx:63-70` (`handleSaveAndNext`)

**Interfaces:**
- Consumes: `saveShotVideo(scriptId, shotId, blob): Promise<void>` from Task 2.

- [ ] **Step 1: Add the import**

In `src/pages/RecordPage.tsx`, add:

```ts
import { saveShotVideo } from '../utils/shotVideoStore'
```

- [ ] **Step 2: Persist the blob on successful save**

Replace `handleSaveAndNext` (currently lines 63-70) with:

```ts
  async function handleSaveAndNext() {
    const saved = await shareOrDownload(getFilename())
    if (!saved) return  // user cancelled — stay on current shot
    if (blobRef.current && currentShot) {
      await saveShotVideo(safeScript.id, currentShot.id, blobRef.current)
    }
    closeModal()
    reset()
    setShotSettingsOpen(false)
    setShotIndex(i => i + 1)
  }
```

Skipped shots (`handleSkipAndNext`) are intentionally left unchanged — they don't get persisted, matching the design ("skipped shots are excluded from the combine step").

- [ ] **Step 3: Manually verify in the dev server**

This touches the recording flow, which depends on `MediaRecorder`/camera APIs that don't run under Vitest — verify by hand:

1. Start the dev server (`npm run dev`), open a script with at least 2 shots, record a shot, use "🖼 カメラロールからインポート" to bring in a short test video clip (any `.mp4` on your machine works for this check), and press "保存して次へ".
2. Open the browser's DevTools → Application → IndexedDB → `teleprompter-shot-videos` → `shotVideos`, and confirm an entry appeared with a key like `<scriptId>::<shotId>` and a `blob` field.
3. Repeat for the second shot with "保存せずに次へ" this time (skip) and confirm **no** new entry is added for it.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: PASS (no regressions — this task has no new automated tests, per the FFmpeg/recording-flow testing convention noted in Global Constraints)

- [ ] **Step 5: Commit**

```bash
git add src/pages/RecordPage.tsx
git commit -m "feat: persist each saved shot's processed video to IndexedDB"
```

---

### Task 4: `FinalizePage` skeleton, route, and entry point

**Files:**
- Create: `src/pages/FinalizePage.tsx`, `src/pages/FinalizePage.module.css`
- Modify: `src/App.tsx` (add route), `src/pages/RecordPage.tsx` (add button on the "撮影完了" screen), `src/pages/RecordPage.module.css` (button style)

**Interfaces:**
- Consumes: `getScript(id)` from `useScripts`, `listShotVideos(scriptId)` from Task 2.
- Produces: route `/scripts/:id/finalize`. Later tasks (5-9) extend this same page's Step 1 UI — they do not create a new page.

- [ ] **Step 1: Add the route**

In `src/App.tsx`, add the import and route:

```ts
import FinalizePage from './pages/FinalizePage'
```

```tsx
      <Route path="/scripts/:id/finalize" element={<FinalizePage />} />
```//(placed after the `/scripts/:id/record` route)

- [ ] **Step 2: Add the entry button on the "撮影完了" screen**

In `src/pages/RecordPage.tsx`, inside the `isComplete` block, add a button above the existing "ショット一覧に戻る" button:

```tsx
        <button
          className={styles.finalizeBtn}
          onClick={() => navigate(`/scripts/${safeScript.id}/finalize`)}
        >
          🎬 動画を仕上げる
        </button>
```

In `src/pages/RecordPage.module.css`, add (near `.doneBtn`):

```css
.finalizeBtn {
  background: var(--accent);
  color: #fff;
  padding: 14px 32px;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 700;
}
```

- [ ] **Step 3: Write the `FinalizePage` skeleton**

Create `src/pages/FinalizePage.module.css`:

```css
.page {
  min-height: 100dvh;
  background: var(--bg);
  padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.backBtn {
  background: none;
  color: var(--text-muted);
  font-size: 0.85rem;
  padding: 8px;
}

.heading {
  font-size: 1.2rem;
  font-weight: 700;
}

.shotList {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.shotEntry {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
}

.shotEntryText {
  color: var(--text);
  font-size: 0.9rem;
  margin-bottom: 8px;
}

.missing {
  color: var(--text-muted);
  font-size: 0.85rem;
  font-style: italic;
}

.preview {
  width: 100%;
  border-radius: 8px;
  background: #000;
}
```

Create `src/pages/FinalizePage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import styles from './FinalizePage.module.css'

interface ShotEntry {
  shotId: string
  text: string
  blob: Blob | null
  url: string | null
}

export default function FinalizePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript } = useScripts()
  const script = id ? getScript(id) : undefined

  const [entries, setEntries] = useState<ShotEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!script) return
    let cancelled = false

    listShotVideos(script.id).then(stored => {
      if (cancelled) return
      const byShotId = new Map(stored.map(v => [v.shotId, v.blob]))
      const next = script.shots.map(shot => {
        const blob = byShotId.get(shot.id) ?? null
        return {
          shotId: shot.id,
          text: shot.text,
          blob,
          url: blob ? URL.createObjectURL(blob) : null,
        }
      })
      setEntries(next)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id])

  // Revoke object URLs on unmount to avoid leaking memory
  useEffect(() => {
    return () => {
      entries.forEach(e => {
        if (e.url) URL.revokeObjectURL(e.url)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!script) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        スクリプトが見つかりません
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(`/scripts/${script.id}/record`)}>
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>動画を仕上げる</h1>
      </div>

      {loading ? (
        <p className={styles.missing}>読み込み中...</p>
      ) : (
        <div className={styles.shotList}>
          {entries.map((entry, i) => (
            <div key={entry.shotId} className={styles.shotEntry}>
              <p className={styles.shotEntryText}>{i + 1}. {entry.text}</p>
              {entry.url ? (
                <video className={styles.preview} src={entry.url} controls playsInline />
              ) : (
                <p className={styles.missing}>この ショットは保存された動画がありません</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Manually verify in the dev server**

1. Complete a script's shots (per Task 3's manual test, at least one shot with a stored video).
2. From the "撮影完了" screen, tap "🎬 動画を仕上げる".
3. Confirm the shot with a stored video shows a playable preview, and — if you skipped a shot earlier — that shot shows "このショットは保存された動画がありません".

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: PASS (no regressions; no new automated tests for this page-wiring task, per Global Constraints)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/pages/FinalizePage.tsx src/pages/FinalizePage.module.css src/pages/RecordPage.tsx src/pages/RecordPage.module.css
git commit -m "feat: add FinalizePage skeleton reachable from the completion screen"
```

---

### Task 5: `clampTrimRange` — pure trim-bounds math

**Files:**
- Create: `src/utils/shotTrim.ts`
- Test: `src/utils/shotTrim.test.ts`

**Interfaces:**
- Produces: `clampTrimRange(start: number, end: number, duration: number, minLength?: number): { start: number; end: number }`. Used by Task 6 (`ShotTrimmer` component).

- [ ] **Step 1: Write the failing tests**

Create `src/utils/shotTrim.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { clampTrimRange } from './shotTrim'

describe('clampTrimRange', () => {
  it('leaves a valid range untouched', () => {
    expect(clampTrimRange(1, 4, 10)).toEqual({ start: 1, end: 4 })
  })

  it('clamps a negative start to 0', () => {
    expect(clampTrimRange(-2, 4, 10)).toEqual({ start: 0, end: 4 })
  })

  it('clamps an end past the clip duration down to the duration', () => {
    expect(clampTrimRange(1, 15, 10)).toEqual({ start: 1, end: 10 })
  })

  it('pushes end forward to respect the minimum length when start moved past it', () => {
    // default minLength is 0.3s
    expect(clampTrimRange(4, 4.1, 10)).toEqual({ start: 4, end: 4.3 })
  })

  it('pulls end back to the duration if enforcing minLength would overflow it', () => {
    expect(clampTrimRange(9.9, 9.95, 10)).toEqual({ start: 9.7, end: 10 })
  })

  it('respects a custom minLength', () => {
    expect(clampTrimRange(0, 0.5, 10, 1)).toEqual({ start: 0, end: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- shotTrim`
Expected: FAIL — `Cannot find module './shotTrim'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/shotTrim.ts`:

```ts
/**
 * Clamp a [start, end] trim range to a clip of the given duration, enforcing
 * a minimum clip length. Used by the trim-handle UI so a drag can never
 * produce an invalid or zero-length range.
 */
export function clampTrimRange(
  start: number,
  end: number,
  duration: number,
  minLength = 0.3,
): { start: number; end: number } {
  let s = Math.max(0, Math.min(start, duration))
  let e = Math.max(0, Math.min(end, duration))

  if (e - s < minLength) {
    e = s + minLength
    if (e > duration) {
      e = duration
      s = Math.max(0, e - minLength)
    }
  }

  return { start: s, end: e }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- shotTrim`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/shotTrim.ts src/utils/shotTrim.test.ts
git commit -m "feat: add clampTrimRange pure helper for shot trim bounds"
```

---

### Task 6: `ShotTrimmer` component — drag-to-trim UI with transition preview

**Files:**
- Create: `src/components/ShotTrimmer.tsx`, `src/components/ShotTrimmer.module.css`

**Interfaces:**
- Consumes: `clampTrimRange` from Task 5.
- Produces: `<ShotTrimmer blob duration trimStart trimEnd onChange onLoadedMetadata nextBlob? />` — `onChange(start, end)` fires as the user drags either handle. Used by Task 9 when wiring Step 1 into `FinalizePage`.

This component is UI/interaction-heavy (pointer dragging) and is verified manually via the dev server, consistent with this repo's existing convention of not writing RTL tests for drag/gesture-driven components (see `ShotEditPage`'s dnd-kit drag handling, which also has no component test). Its pure math (`clampTrimRange`) is already tested in Task 5.

- [ ] **Step 1: Write the component**

Create `src/components/ShotTrimmer.module.css`:

```css
.wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.video {
  width: 100%;
  border-radius: 8px;
  background: #000;
}

.timeline {
  position: relative;
  height: 36px;
  background: var(--surface2);
  border-radius: 8px;
  touch-action: none;
}

.selectedRange {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--accent);
  opacity: 0.35;
  border-radius: 8px;
}

.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 16px;
  margin-left: -8px;
  background: var(--accent);
  border-radius: 4px;
  cursor: ew-resize;
}

.readout {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.transitionBtn {
  align-self: flex-start;
  background: var(--surface2);
  color: var(--text);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.8rem;
}
```

Create `src/components/ShotTrimmer.tsx`:

```tsx
import { useRef, useState } from 'react'
import { clampTrimRange } from '../utils/shotTrim'
import styles from './ShotTrimmer.module.css'

interface ShotTrimmerProps {
  url: string
  nextUrl: string | null // the next shot's preview URL, for the transition check
  trimStart: number
  trimEnd: number
  onChange: (start: number, end: number) => void
  onDurationKnown: (duration: number) => void
  duration: number // 0 until onDurationKnown has fired
}

const TRANSITION_WINDOW = 1.5 // seconds shown from each side of the cut

export default function ShotTrimmer({
  url,
  nextUrl,
  trimStart,
  trimEnd,
  onChange,
  onDurationKnown,
  duration,
}: ShotTrimmerProps) {
  const timelineRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const nextVideoRef = useRef<HTMLVideoElement>(null)
  const draggingRef = useRef<'start' | 'end' | null>(null)
  const [previewingTransition, setPreviewingTransition] = useState(false)

  function timeFromPointerX(clientX: number): number {
    const el = timelineRef.current
    if (!el || duration === 0) return 0
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  function handlePointerDown(which: 'start' | 'end') {
    draggingRef.current = which
  }

  function handlePointerMove(e: React.PointerEvent) {
    const which = draggingRef.current
    if (!which || duration === 0) return
    const t = timeFromPointerX(e.clientX)
    const { start, end } =
      which === 'start'
        ? clampTrimRange(t, trimEnd, duration)
        : clampTrimRange(trimStart, t, duration)
    onChange(start, end)
  }

  function handlePointerUp() {
    draggingRef.current = null
  }

  async function playTransitionPreview() {
    const a = videoRef.current
    const b = nextVideoRef.current
    if (!a || !b || !nextUrl) return

    setPreviewingTransition(true)
    a.currentTime = Math.max(0, trimEnd - TRANSITION_WINDOW)
    await a.play()

    a.onpause = null
    const stopAtEnd = () => {
      if (a.currentTime >= trimEnd) {
        a.pause()
        a.removeEventListener('timeupdate', stopAtEnd)
        b.currentTime = 0
        b.play()
        const stopB = () => {
          if (b.currentTime >= TRANSITION_WINDOW) {
            b.pause()
            b.removeEventListener('timeupdate', stopB)
            setPreviewingTransition(false)
          }
        }
        b.addEventListener('timeupdate', stopB)
      }
    }
    a.addEventListener('timeupdate', stopAtEnd)
  }

  const startPct = duration ? (trimStart / duration) * 100 : 0
  const endPct = duration ? (trimEnd / duration) * 100 : 100

  return (
    <div className={styles.wrapper}>
      <video
        ref={videoRef}
        className={styles.video}
        src={url}
        controls
        playsInline
        onLoadedMetadata={e => onDurationKnown(e.currentTarget.duration)}
      />

      <div
        ref={timelineRef}
        className={styles.timeline}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div
          className={styles.selectedRange}
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />
        <div
          className={styles.handle}
          style={{ left: `${startPct}%` }}
          onPointerDown={() => handlePointerDown('start')}
        />
        <div
          className={styles.handle}
          style={{ left: `${endPct}%` }}
          onPointerDown={() => handlePointerDown('end')}
        />
      </div>

      <div className={styles.readout}>
        <span>開始 {trimStart.toFixed(1)}秒</span>
        <span>終了 {trimEnd.toFixed(1)}秒</span>
      </div>

      {nextUrl && (
        <>
          <button
            type="button"
            className={styles.transitionBtn}
            onClick={playTransitionPreview}
            disabled={previewingTransition}
          >
            {previewingTransition ? '再生中...' : '▶ 次のショットとのつなぎ目を確認'}
          </button>
          {/* Hidden second player used only to play the next clip's opening frames */}
          <video ref={nextVideoRef} src={nextUrl} playsInline style={{ display: 'none' }} />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Manually verify in the dev server**

1. Temporarily render a `<ShotTrimmer>` in `FinalizePage` for a shot entry that has a `url` (wire it loosely for this check — Task 9 will do the real wiring), passing `nextUrl={null}`.
2. Confirm: the video plays, dragging either handle moves it and updates the readout numbers, and the handles cannot cross (min length enforced).
3. Pass a real `nextUrl` for a two-shot script and confirm "▶ 次のショットとのつなぎ目を確認" plays roughly the last 1.5s of the first clip followed by the first 1.5s of the second.
4. Revert the temporary wiring — Task 9 does this for real.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: PASS (no regressions; no automated test added for this component per Global Constraints)

- [ ] **Step 4: Commit**

```bash
git add src/components/ShotTrimmer.tsx src/components/ShotTrimmer.module.css
git commit -m "feat: add ShotTrimmer drag-to-trim component with transition preview"
```

---

### Task 7: `trimAndNormalizeShot` — FFmpeg re-encode at trim bounds

Re-encodes (not stream-copies) each shot to a fixed profile at the user-adjusted trim bounds. Re-encoding here — instead of `-c copy`, which can only cut on keyframe boundaries — is what makes the cut frame-accurate, and normalizes every clip to the same codec/resolution so Task 8's concat step can use the fast concat demuxer.

**Files:**
- Create: `src/utils/trimAndNormalizeShot.ts`
- Test: `src/utils/trimAndNormalizeShot.test.ts`

**Interfaces:**
- Produces: `buildTrimAndNormalizeArgs(start: number, end: number): string[]` (pure, tested), `trimAndNormalizeShot(blob: Blob, start: number, end: number): Promise<Blob>` (FFmpeg-calling, manually verified). Used by Task 9.

- [ ] **Step 1: Write the failing test for the pure arg-builder**

Create `src/utils/trimAndNormalizeShot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildTrimAndNormalizeArgs } from './trimAndNormalizeShot'

describe('buildTrimAndNormalizeArgs', () => {
  it('places -ss and -t around the input, re-encodes to a fixed H.264/AAC profile', () => {
    const args = buildTrimAndNormalizeArgs(1.5, 4.0)
    expect(args).toEqual([
      '-ss', '1.500',
      '-i', 'in.mp4',
      '-t', '2.500',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      'out.mp4',
    ])
  })

  it('omits -ss entirely when start is 0 (nothing to seek past)', () => {
    const args = buildTrimAndNormalizeArgs(0, 3.2)
    expect(args[0]).toBe('-i')
    expect(args).toContain('-t')
    expect(args[args.indexOf('-t') + 1]).toBe('3.200')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- trimAndNormalizeShot`
Expected: FAIL — `Cannot find module './trimAndNormalizeShot'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/trimAndNormalizeShot.ts`:

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
 * Build the FFmpeg args that trim [start, end] out of in.mp4 and re-encode
 * to a fixed 1080x1920 H.264/AAC profile (letterboxed if the source aspect
 * ratio differs), so every clip matches for a fast concat-demuxer pass.
 */
export function buildTrimAndNormalizeArgs(start: number, end: number): string[] {
  const args: string[] = []
  if (start > 0.001) {
    args.push('-ss', start.toFixed(3))
  }
  args.push('-i', 'in.mp4')
  args.push('-t', (end - start).toFixed(3))
  args.push(
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    'out.mp4',
  )
  return args
}

export async function trimAndNormalizeShot(blob: Blob, start: number, end: number): Promise<Blob> {
  const ff = await getFFmpeg()
  await ff.writeFile('in.mp4', await fetchFile(blob))
  await ff.exec(buildTrimAndNormalizeArgs(start, end))
  const data = await ff.readFile('out.mp4')
  ff.deleteFile('in.mp4')
  ff.deleteFile('out.mp4')
  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- trimAndNormalizeShot`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/trimAndNormalizeShot.ts src/utils/trimAndNormalizeShot.test.ts
git commit -m "feat: add trimAndNormalizeShot with a pure, tested arg builder"
```

---

### Task 8: `concatVideos` — FFmpeg concat-demuxer combine

**Files:**
- Create: `src/utils/concatVideos.ts`
- Test: `src/utils/concatVideos.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent util).
- Produces: `buildConcatListFile(filenames: string[]): string` (pure, tested), `concatVideos(blobs: Blob[]): Promise<Blob>` (FFmpeg-calling, manually verified). Used by Task 9.

- [ ] **Step 1: Write the failing test for the pure list-file builder**

Create `src/utils/concatVideos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildConcatListFile } from './concatVideos'

describe('buildConcatListFile', () => {
  it('formats one "file" line per clip in order', () => {
    const result = buildConcatListFile(['clip0.mp4', 'clip1.mp4', 'clip2.mp4'])
    expect(result).toBe("file 'clip0.mp4'\nfile 'clip1.mp4'\nfile 'clip2.mp4'\n")
  })

  it('works for a single clip', () => {
    expect(buildConcatListFile(['only.mp4'])).toBe("file 'only.mp4'\n")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- concatVideos`
Expected: FAIL — `Cannot find module './concatVideos'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/concatVideos.ts`:

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

/** Build the concat-demuxer list file content FFmpeg's `-f concat` expects. */
export function buildConcatListFile(filenames: string[]): string {
  return filenames.map(name => `file '${name}'\n`).join('')
}

/**
 * Concatenate already-normalized (same codec/resolution) clips with the fast
 * concat demuxer (-c copy). Callers are expected to have run each clip
 * through trimAndNormalizeShot first so the streams match.
 */
export async function concatVideos(blobs: Blob[]): Promise<Blob> {
  const ff = await getFFmpeg()
  const filenames = await Promise.all(
    blobs.map(async (blob, i) => {
      const name = `clip${i}.mp4`
      await ff.writeFile(name, await fetchFile(blob))
      return name
    }),
  )

  await ff.writeFile('list.txt', buildConcatListFile(filenames))
  await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4'])
  const data = await ff.readFile('out.mp4')

  await Promise.all(filenames.map(name => ff.deleteFile(name)))
  ff.deleteFile('list.txt')
  ff.deleteFile('out.mp4')

  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- concatVideos`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/concatVideos.ts src/utils/concatVideos.test.ts
git commit -m "feat: add concatVideos with a pure, tested list-file builder"
```

---

### Task 9: Wire Step 1 end-to-end in `FinalizePage`

Replaces the plain `<video>` list from Task 4 with `ShotTrimmer` per shot, adds a "結合する" button that runs `trimAndNormalizeShot` + `concatVideos`, and shows the combined result with a share/download button.

**Files:**
- Modify: `src/pages/FinalizePage.tsx`, `src/pages/FinalizePage.module.css`

**Interfaces:**
- Consumes: `ShotTrimmer` (Task 6), `trimAndNormalizeShot` (Task 7), `concatVideos` (Task 8), `shareOrDownload` (Task 1).

- [ ] **Step 1: Extend state and add the combine handler**

Replace the contents of `src/pages/FinalizePage.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import { trimAndNormalizeShot } from '../utils/trimAndNormalizeShot'
import { concatVideos } from '../utils/concatVideos'
import { shareOrDownload } from '../utils/shareOrDownload'
import ShotTrimmer from '../components/ShotTrimmer'
import styles from './FinalizePage.module.css'

interface ShotEntry {
  shotId: string
  text: string
  blob: Blob | null
  url: string | null
  duration: number
  trimStart: number
  trimEnd: number
}

type CombineState = 'idle' | 'combining' | 'done' | 'error'

export default function FinalizePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript } = useScripts()
  const script = id ? getScript(id) : undefined

  const [entries, setEntries] = useState<ShotEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [combineState, setCombineState] = useState<CombineState>('idle')
  const [combineError, setCombineError] = useState<string | null>(null)
  const [combinedUrl, setCombinedUrl] = useState<string | null>(null)
  const [combinedBlob, setCombinedBlob] = useState<Blob | null>(null)

  useEffect(() => {
    if (!script) return
    let cancelled = false

    listShotVideos(script.id).then(stored => {
      if (cancelled) return
      const byShotId = new Map(stored.map(v => [v.shotId, v.blob]))
      const next = script.shots.map(shot => {
        const blob = byShotId.get(shot.id) ?? null
        return {
          shotId: shot.id,
          text: shot.text,
          blob,
          url: blob ? URL.createObjectURL(blob) : null,
          duration: 0,
          trimStart: 0,
          trimEnd: 0,
        }
      })
      setEntries(next)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id])

  function updateEntry(shotId: string, changes: Partial<ShotEntry>) {
    setEntries(prev => prev.map(e => (e.shotId === shotId ? { ...e, ...changes } : e)))
  }

  const availableEntries = entries.filter(e => e.blob)
  const canCombine = availableEntries.length > 0 && availableEntries.every(e => e.duration > 0)

  async function handleCombine() {
    setCombineState('combining')
    setCombineError(null)
    try {
      const normalized: Blob[] = []
      for (const entry of availableEntries) {
        const trimmed = await trimAndNormalizeShot(entry.blob!, entry.trimStart, entry.trimEnd || entry.duration)
        normalized.push(trimmed)
      }
      const combined = await concatVideos(normalized)
      setCombinedBlob(combined)
      setCombinedUrl(URL.createObjectURL(combined))
      setCombineState('done')
    } catch (err) {
      setCombineError(err instanceof Error ? err.message : String(err))
      setCombineState('error')
    }
  }

  async function handleSaveCombined() {
    if (!combinedBlob || !script) return
    await shareOrDownload(combinedBlob, `${script.title}-combined`)
  }

  if (!script) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        スクリプトが見つかりません
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(`/scripts/${script.id}/record`)}>
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>動画を仕上げる</h1>
      </div>

      {loading ? (
        <p className={styles.missing}>読み込み中...</p>
      ) : (
        <>
          <div className={styles.shotList}>
            {entries.map((entry, i) => {
              const next = entries[i + 1]
              return (
                <div key={entry.shotId} className={styles.shotEntry}>
                  <p className={styles.shotEntryText}>{i + 1}. {entry.text}</p>
                  {entry.url ? (
                    <ShotTrimmer
                      url={entry.url}
                      nextUrl={next?.url ?? null}
                      duration={entry.duration}
                      trimStart={entry.trimStart}
                      trimEnd={entry.trimEnd || entry.duration}
                      onDurationKnown={duration =>
                        updateEntry(entry.shotId, { duration, trimEnd: duration })
                      }
                      onChange={(trimStart, trimEnd) => updateEntry(entry.shotId, { trimStart, trimEnd })}
                    />
                  ) : (
                    <p className={styles.missing}>このショットは保存された動画がありません</p>
                  )}
                </div>
              )
            })}
          </div>

          <button
            className={styles.finalizeBtn}
            onClick={handleCombine}
            disabled={!canCombine || combineState === 'combining'}
          >
            {combineState === 'combining' ? '結合中...' : '結合する'}
          </button>

          {combineState === 'error' && (
            <p className={styles.missing}>結合に失敗しました: {combineError}</p>
          )}

          {combineState === 'done' && combinedUrl && (
            <div className={styles.shotEntry}>
              <p className={styles.shotEntryText}>結合結果</p>
              <video className={styles.preview} src={combinedUrl} controls playsInline />
              <button className={styles.finalizeBtn} onClick={handleSaveCombined}>
                保存する
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the missing style**

In `src/pages/FinalizePage.module.css`, add:

```css
.finalizeBtn {
  background: var(--accent);
  color: #fff;
  padding: 14px 32px;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 700;
  margin-top: 16px;
}

.finalizeBtn:disabled {
  opacity: 0.5;
}
```

- [ ] **Step 3: Manually verify in the dev server**

1. Complete a 2-3 shot script so at least two shots have stored videos (per Task 3's flow).
2. Open "🎬 動画を仕上げる", confirm each shot shows its `ShotTrimmer`, drag a couple of handles, use the transition-preview button.
3. Tap "結合する", confirm the spinner/label state, then confirm a combined preview video appears and plays start-to-end across the shot boundaries at the trimmed points.
4. Tap "保存する" and confirm the share sheet appears (or the file downloads) with a name like `<title>-combined.mp4`.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: PASS (no regressions)

- [ ] **Step 5: Commit**

```bash
git add src/pages/FinalizePage.tsx src/pages/FinalizePage.module.css
git commit -m "feat: wire trim + combine + save into FinalizePage Step 1"
```

---

## Self-Review Notes

- **Spec coverage:** This plan covers the design doc's "Step 1 — Trim & Combine" section plus the IndexedDB persistence and Finalize-screen entry point it depends on. Steps 2-5 (English captions, Claude handoff, subtitle burn-in, BGM) are intentionally out of scope for Phase A and will be their own plans (Phase B: subtitles; Phase C: BGM + export), since Phase A already produces a complete, independently useful, testable feature (record shots → trim → combine → save one video) without them.
- **Type consistency:** `ShotEntry` in Task 4 is superseded by the richer `ShotEntry` in Task 9 (same file, same name, extended shape) — Task 9 replaces the whole file rather than patching it, so there's no drift between two different `ShotEntry` definitions.
- **No placeholders:** every step has complete, runnable code; FFmpeg-calling functions are explicitly marked as manually-verified (with concrete manual steps), not left untested with a vague "should be tested" note.
