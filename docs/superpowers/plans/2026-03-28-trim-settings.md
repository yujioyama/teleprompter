# Trim Settings Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to toggle auto-trimming on/off and configure the silence padding duration, both globally and per-shot.

**Architecture:** A new `useSettings` hook persists global trim preferences to localStorage. The `Shot` type gains optional `trimEnabled`/`trimPadding` fields for per-shot overrides (undefined = use global). `detectSpeechBounds` accepts `padding` as a parameter instead of a hardcoded constant. `startRecording` receives effective settings at call time to avoid stale closures.

**Tech Stack:** React, TypeScript, Vitest, localStorage, @testing-library/react

---

## Chunk 1: Foundation — types + useSettings hook

### Task 1: Add trim override fields to Shot type

**Files:**
- Modify: `teleprompter-app/src/types.ts`

- [ ] **Step 1: Add optional fields to Shot**

```ts
export interface Shot {
  id: string
  text: string
  trimEnabled?: boolean  // undefined = use global setting
  trimPadding?: number   // undefined = use global setting
}
```

- [ ] **Step 2: Run build to confirm no type errors**

```bash
cd teleprompter-app && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors (existing code uses `{ id, text }` spreads, so optional fields are backward-compatible)

- [ ] **Step 3: Commit**

```bash
git add teleprompter-app/src/types.ts
git commit -m "feat: add trimEnabled/trimPadding override fields to Shot type"
```

---

### Task 2: Create useSettings hook

**Files:**
- Create: `teleprompter-app/src/hooks/useSettings.ts`
- Create: `teleprompter-app/src/hooks/useSettings.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// teleprompter-app/src/hooks/useSettings.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettings } from './useSettings'

beforeEach(() => {
  localStorage.clear()
})

describe('useSettings', () => {
  it('returns defaults when localStorage is empty', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ trimEnabled: true, trimPadding: 0.5 })
  })

  it('updates trimEnabled', () => {
    const { result } = renderHook(() => useSettings())
    act(() => {
      result.current[1]({ trimEnabled: false })
    })
    expect(result.current[0].trimEnabled).toBe(false)
    expect(result.current[0].trimPadding).toBe(0.5) // unchanged
  })

  it('updates trimPadding', () => {
    const { result } = renderHook(() => useSettings())
    act(() => {
      result.current[1]({ trimPadding: 1.2 })
    })
    expect(result.current[0].trimPadding).toBe(1.2)
    expect(result.current[0].trimEnabled).toBe(true) // unchanged
  })

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useSettings())
    act(() => {
      result.current[1]({ trimPadding: 0.8 })
    })
    const raw = localStorage.getItem('teleprompter_settings')
    expect(JSON.parse(raw!).trimPadding).toBe(0.8)
  })

  it('loads persisted settings on mount', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false, trimPadding: 1.0 }))
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ trimEnabled: false, trimPadding: 1.0 })
  })

  it('falls back to defaults when localStorage contains invalid JSON', () => {
    localStorage.setItem('teleprompter_settings', 'not-json')
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ trimEnabled: true, trimPadding: 0.5 })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd teleprompter-app && npm test -- useSettings 2>&1 | tail -20
```
Expected: FAIL — `useSettings` not found

- [ ] **Step 3: Implement the hook**

```ts
// teleprompter-app/src/hooks/useSettings.ts
import { useState } from 'react'

export interface AppSettings {
  trimEnabled: boolean
  trimPadding: number
}

const STORAGE_KEY = 'teleprompter_settings'
const DEFAULTS: AppSettings = { trimEnabled: true, trimPadding: 0.5 }

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  function updateSettings(patch: Partial<AppSettings>) {
    const next = { ...settings, ...patch }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSettings(next)
  }

  return [settings, updateSettings]
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd teleprompter-app && npm test -- useSettings 2>&1 | tail -20
```
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add teleprompter-app/src/hooks/useSettings.ts teleprompter-app/src/hooks/useSettings.test.ts
git commit -m "feat: add useSettings hook with localStorage persistence"
```

---

## Chunk 2: Core — detectSpeechBounds + useRecorder

### Task 3: Update detectSpeechBounds to accept padding parameter

**Files:**
- Modify: `teleprompter-app/src/utils/detectSpeechBounds.ts`

- [ ] **Step 1: Update function signature to accept padding**

Replace the top of `detectSpeechBounds.ts`:

```ts
// Remove this line:
const PADDING_S = 0.5      // seconds to keep before/after speech

// Change function signature from:
export async function detectSpeechBounds(blob: Blob): Promise<SpeechBounds | null>
// To:
export async function detectSpeechBounds(blob: Blob, padding: number): Promise<SpeechBounds | null>
```

Replace the two uses of `PADDING_S` inside the function (lines 64–65) with `padding`:

```ts
const start = Math.max(0, speechStart - padding)
const end = Math.min(duration, speechEnd + padding)
```

- [ ] **Step 2: Run build to catch the broken call site in useRecorder**

```bash
cd teleprompter-app && npm run build 2>&1 | grep -E "error|Error"
```
Expected: TypeScript error — `detectSpeechBounds` called with wrong number of arguments in `useRecorder.ts`

- [ ] **Step 3: Update the call site in useRecorder.ts temporarily (will be replaced in Task 4)**

In `teleprompter-app/src/hooks/useRecorder.ts`, line 63, update:
```ts
// From:
const trim = await detectSpeechBounds(raw)
// To (keep default for now, Task 4 will pass the real value):
const trim = await detectSpeechBounds(raw, 0.5)
```

- [ ] **Step 4: Run build again to confirm no errors**

```bash
cd teleprompter-app && npm run build 2>&1 | tail -10
```
Expected: no errors

- [ ] **Step 5: Run all tests**

```bash
cd teleprompter-app && npm test 2>&1 | tail -20
```
Expected: all tests PASS (detectSpeechBounds has no dedicated test — browser API — but existing tests should not break)

- [ ] **Step 6: Commit**

```bash
git add teleprompter-app/src/utils/detectSpeechBounds.ts teleprompter-app/src/hooks/useRecorder.ts
git commit -m "refactor: make detectSpeechBounds padding configurable via parameter"
```

---

### Task 4: Update useRecorder to accept shotSettings in startRecording

**Files:**
- Modify: `teleprompter-app/src/hooks/useRecorder.ts`

- [ ] **Step 1: Update startRecording signature and UseRecorderResult interface**

In `teleprompter-app/src/hooks/useRecorder.ts`:

1. Add a `ShotTrimSettings` type and update the interface:
```ts
export interface ShotTrimSettings {
  trimEnabled: boolean
  trimPadding: number
}

interface UseRecorderResult {
  state: RecordState
  remuxOk: boolean | null
  remuxError: string | null
  startRecording: (stream: MediaStream, shotSettings: ShotTrimSettings) => void
  stopRecording: () => void
  shareOrDownload: (filename: string) => Promise<void>
  reset: () => void
  blobRef: Readonly<RefObject<Blob | null>>
}
```

2. Update the `startRecording` function to accept `shotSettings` and use it inside `onstop`:
```ts
function startRecording(stream: MediaStream, shotSettings: ShotTrimSettings) {
  // ... (existing setup code unchanged) ...

  recorder.onstop = async () => {
    const raw = new Blob(chunksRef.current, {
      type: mimeType || 'video/webm',
    })

    if (mimeType.includes('mp4')) {
      setState('remuxing')
      let trim = null
      if (shotSettings.trimEnabled) {
        trim = await detectSpeechBounds(raw, shotSettings.trimPadding)
      }
      const result = await remuxMp4(raw, { trim: trim ?? undefined })
      blobRef.current = result.blob
      setRemuxOk(result.ok)
      setRemuxError(result.error ?? null)
    } else {
      // webm: trimming not supported, silently ignored
      blobRef.current = raw
      setRemuxOk(true)
    }

    setState('stopped')
  }

  recorder.start()
  setState('recording')
}
```

- [ ] **Step 2: Run build**

```bash
cd teleprompter-app && npm run build 2>&1 | grep -E "error|Error"
```
Expected: TypeScript error in `RecordPage.tsx` — `startRecording` now requires a second argument

- [ ] **Step 3: Temporarily fix RecordPage.tsx call site (will be replaced in Task 7)**

In `teleprompter-app/src/pages/RecordPage.tsx`, line 92, update `handleRecord`:
```ts
function handleRecord() {
  if (state !== 'idle') return
  const stream = (videoRef.current?.srcObject as MediaStream) ?? null
  if (!stream) return
  startRecording(stream, { trimEnabled: true, trimPadding: 0.5 })
}
```

- [ ] **Step 4: Run build + tests**

```bash
cd teleprompter-app && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10
```
Expected: no errors, all tests pass

- [ ] **Step 5: Commit**

```bash
git add teleprompter-app/src/hooks/useRecorder.ts teleprompter-app/src/pages/RecordPage.tsx
git commit -m "feat: pass shotSettings to startRecording for per-shot trim control"
```

---

## Chunk 3: Settings UI

### Task 5: Create SettingsPage

**Files:**
- Create: `teleprompter-app/src/pages/SettingsPage.tsx`
- Create: `teleprompter-app/src/pages/SettingsPage.module.css`
- Modify: `teleprompter-app/src/App.tsx`
- Modify: `teleprompter-app/src/pages/HomePage.tsx`
- Modify: `teleprompter-app/src/pages/HomePage.module.css`

- [ ] **Step 1: Create SettingsPage.module.css**

```css
/* teleprompter-app/src/pages/SettingsPage.module.css */
.page {
  max-width: 600px;
  margin: 0 auto;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
}

.backBtn {
  background: none;
  color: var(--text-muted);
  font-size: 1.2rem;
  padding: 4px 8px;
}

.title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text);
}

.section {
  padding: 24px 16px 8px;
}

.sectionTitle {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}

.rowLabel {
  font-size: 1rem;
  color: var(--text);
}

.rowSub {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.toggle {
  position: relative;
  width: 48px;
  height: 28px;
  flex-shrink: 0;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggleTrack {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  background: var(--border);
  transition: background 0.2s;
  cursor: pointer;
}

.toggle input:checked + .toggleTrack {
  background: var(--accent);
}

.toggleTrack::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.toggle input:checked + .toggleTrack::after {
  transform: translateX(20px);
}

.sliderRow {
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.sliderHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.sliderValue {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--accent);
}

.slider {
  width: 100%;
  accent-color: var(--accent);
}

.disabled {
  opacity: 0.4;
  pointer-events: none;
}
```

- [ ] **Step 2: Create SettingsPage.tsx**

```tsx
// teleprompter-app/src/pages/SettingsPage.tsx
import { useNavigate } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const navigate = useNavigate()
  const [settings, updateSettings] = useSettings()

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>‹</button>
        <h1 className={styles.title}>設定</h1>
      </header>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>自動トリミング</div>

        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>無音部分を自動カット</div>
            <div className={styles.rowSub}>録画後に前後の無音を除去します</div>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={settings.trimEnabled}
              onChange={e => updateSettings({ trimEnabled: e.target.checked })}
            />
            <span className={styles.toggleTrack} />
          </label>
        </div>

        <div className={`${styles.row} ${styles.sliderRow} ${!settings.trimEnabled ? styles.disabled : ''}`}>
          <div className={styles.sliderHeader}>
            <div>
              <div className={styles.rowLabel}>前後に残す時間</div>
              <div className={styles.rowSub}>音声の前後に保持する無音の長さ</div>
            </div>
            <span className={styles.sliderValue}>{settings.trimPadding.toFixed(1)}秒</span>
          </div>
          <input
            type="range"
            className={styles.slider}
            min={0.2}
            max={2.0}
            step={0.1}
            value={settings.trimPadding}
            onChange={e => updateSettings({ trimPadding: parseFloat(e.target.value) })}
            disabled={!settings.trimEnabled}
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add /settings route in App.tsx**

```tsx
// teleprompter-app/src/App.tsx
import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ScriptEditPage from './pages/ScriptEditPage'
import ShotEditPage from './pages/ShotEditPage'
import RecordPage from './pages/RecordPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/scripts/new" element={<ScriptEditPage />} />
      <Route path="/scripts/:id/edit" element={<ScriptEditPage />} />
      <Route path="/scripts/:id/shots" element={<ShotEditPage />} />
      <Route path="/scripts/:id/record" element={<RecordPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  )
}
```

- [ ] **Step 4: Add gear icon button to HomePage.tsx**

In `teleprompter-app/src/pages/HomePage.tsx`, update the header to add a settings button between the title and the new button:

```tsx
<header className={styles.header}>
  <h1 className={styles.title}>🎬 Teleprompter</h1>
  <div className={styles.headerActions}>
    <button
      className={styles.settingsBtn}
      onClick={() => navigate('/settings')}
      aria-label="設定"
    >
      ⚙
    </button>
    <button
      className={styles.newBtn}
      onClick={() => navigate('/scripts/new')}
    >
      ＋ 新規
    </button>
  </div>
</header>
```

- [ ] **Step 5: Add CSS for headerActions and settingsBtn in HomePage.module.css**

Add to the end of `teleprompter-app/src/pages/HomePage.module.css`:

```css
.headerActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settingsBtn {
  background: none;
  color: var(--text-muted);
  font-size: 1.3rem;
  padding: 6px 8px;
  border-radius: 8px;
}
```

- [ ] **Step 6: Run build + tests**

```bash
cd teleprompter-app && npm run build 2>&1 | tail -10 && npm test 2>&1 | tail -10
```
Expected: no errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add teleprompter-app/src/pages/SettingsPage.tsx teleprompter-app/src/pages/SettingsPage.module.css teleprompter-app/src/App.tsx teleprompter-app/src/pages/HomePage.tsx teleprompter-app/src/pages/HomePage.module.css
git commit -m "feat: add settings page with global trim on/off and padding controls"
```

---

## Chunk 4: RecordPage per-shot override

### Task 6: Add per-shot override UI to RecordPage

**Files:**
- Modify: `teleprompter-app/src/pages/RecordPage.tsx`
- Modify: `teleprompter-app/src/pages/RecordPage.module.css`

- [ ] **Step 1: Add CSS for shot settings panel in RecordPage.module.css**

Add to the end of `teleprompter-app/src/pages/RecordPage.module.css`:

```css
/* Per-shot trim settings */
.shotSettings {
  padding: 0 16px 8px;
  border-bottom: 1px solid var(--border);
}

.shotSettingsToggle {
  background: none;
  color: var(--text-muted);
  font-size: 0.8rem;
  padding: 6px 0;
  width: 100%;
  text-align: left;
}

.shotSettingsPanel {
  padding: 12px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.shotSettingsRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.shotSettingsLabel {
  font-size: 0.85rem;
  color: var(--text);
}

.shotSettingsSub {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.toggle {
  position: relative;
  width: 44px;
  height: 26px;
  flex-shrink: 0;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggleTrack {
  position: absolute;
  inset: 0;
  border-radius: 13px;
  background: var(--border);
  transition: background 0.2s;
  cursor: pointer;
}

.toggle input:checked + .toggleTrack {
  background: var(--accent);
}

.toggleTrack::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.toggle input:checked + .toggleTrack::after {
  transform: translateX(18px);
}

.sliderGroup {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sliderGroupHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sliderValue {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent);
}

.shotSlider {
  width: 100%;
  accent-color: var(--accent);
}

.overrideDisabled {
  opacity: 0.4;
  pointer-events: none;
}
```

- [ ] **Step 2: Update RecordPage.tsx to wire per-shot settings**

Replace the full `RecordPage.tsx` with this implementation:

```tsx
// teleprompter-app/src/pages/RecordPage.tsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import { useCamera } from '../hooks/useCamera'
import { useRecorder } from '../hooks/useRecorder'
import { useWakeLock } from '../hooks/useWakeLock'
import CameraPreview from '../components/CameraPreview'
import VideoReviewModal from '../components/VideoReviewModal'
import styles from './RecordPage.module.css'

export default function RecordPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript, updateScript } = useScripts()
  const [globalSettings] = useSettings()
  const script = id ? getScript(id) : undefined

  const [shotIndex, setShotIndex] = useState(0)
  const { videoRef, error: cameraError, ready, restart: restartCamera } = useCamera()
  const { state, startRecording, stopRecording, shareOrDownload, reset, blobRef } = useRecorder()
  const { supported: wakeLockSupported } = useWakeLock()

  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [shotSettingsOpen, setShotSettingsOpen] = useState(false)

  if (!script || script.shots.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        スクリプトが見つかりません
      </div>
    )
  }

  const safeScript = script
  const isComplete = shotIndex >= safeScript.shots.length
  const currentShot = safeScript.shots[shotIndex] as (typeof safeScript.shots)[0] | undefined
  const isLast = shotIndex === safeScript.shots.length - 1

  // Effective settings: shot override ?? global
  const effectiveTrimEnabled = currentShot?.trimEnabled ?? globalSettings.trimEnabled
  const effectiveTrimPadding = currentShot?.trimPadding ?? globalSettings.trimPadding
  const hasOverride = currentShot?.trimEnabled !== undefined || currentShot?.trimPadding !== undefined

  function getFilename() {
    const safeTitle = safeScript.title.replace(/[^a-zA-Z0-9ぁ-ん一-龯ァ-ン]/g, '-')
    const num = String(shotIndex + 1).padStart(3, '0')
    return `${safeTitle}-shot-${num}`
  }

  function handleStop() {
    stopRecording()
  }

  async function handleNext() {
    try {
      await shareOrDownload(getFilename())
    } catch {
      // save cancelled or failed — still advance
    }
    closeModal()
    reset()
    setShotIndex(i => i + 1)
  }

  function openModal() {
    if (isReviewing) return
    if (!blobRef.current) return
    try {
      const url = URL.createObjectURL(blobRef.current)
      setReviewUrl(url)
      setIsReviewing(true)
    } catch (err) {
      console.error('createObjectURL failed', err)
    }
  }

  function closeModal() {
    if (reviewUrl) {
      URL.revokeObjectURL(reviewUrl)
    }
    setReviewUrl(null)
    setIsReviewing(false)
  }

  function handleRetry() {
    closeModal()
    reset()
    setShotSettingsOpen(false)
  }

  function handleRecord() {
    if (state !== 'idle') return
    const stream = (videoRef.current?.srcObject as MediaStream) ?? null
    if (!stream) return
    startRecording(stream, { trimEnabled: effectiveTrimEnabled, trimPadding: effectiveTrimPadding })
  }

  function handleToggleOverride(enabled: boolean) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id
        ? { ...s, trimEnabled: enabled ? globalSettings.trimEnabled : undefined, trimPadding: enabled ? globalSettings.trimPadding : undefined }
        : s
    )
    updateScript(id, { shots: updatedShots })
  }

  function handleShotTrimEnabled(value: boolean) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, trimEnabled: value } : s
    )
    updateScript(id, { shots: updatedShots })
  }

  function handleShotTrimPadding(value: number) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, trimPadding: value } : s
    )
    updateScript(id, { shots: updatedShots })
  }

  if (isComplete) {
    return (
      <div className={styles.complete}>
        <div className={styles.completeIcon}>🎉</div>
        <h2 className={styles.completeTitle}>撮影完了！</h2>
        <p className={styles.completeSub}>
          {safeScript.shots.length}ショット すべて録画しました
        </p>
        <button
          className={styles.doneBtn}
          onClick={() => navigate(`/scripts/${safeScript.id}/shots`)}
        >
          ショット一覧に戻る
        </button>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Wake Lock warning */}
      {!wakeLockSupported && (
        <div className={styles.wakeLockWarning}>
          ⚠️ 画面オフに注意してください（iOS 16.4未満では自動防止できません）
        </div>
      )}

      {/* Camera error */}
      {cameraError && (
        <div className={styles.errorBanner}>{cameraError}</div>
      )}

      {/* Shot counter */}
      <div className={styles.counter}>
        {shotIndex + 1} / {safeScript.shots.length}
      </div>

      {/* Teleprompter text — top of screen, near front camera */}
      <div className={styles.promptArea}>
        <p className={styles.promptText}>{currentShot?.text}</p>
      </div>

      {/* Per-shot trim settings */}
      {state === 'idle' && (
        <div className={styles.shotSettings}>
          <button
            className={styles.shotSettingsToggle}
            onClick={() => setShotSettingsOpen(o => !o)}
          >
            ⚙ このショットの設定{hasOverride ? ' ●' : ''} {shotSettingsOpen ? '▲' : '▼'}
          </button>

          {shotSettingsOpen && (
            <div className={styles.shotSettingsPanel}>
              {/* Use global / override toggle */}
              <div className={styles.shotSettingsRow}>
                <div>
                  <div className={styles.shotSettingsLabel}>グローバル設定を使用</div>
                  <div className={styles.shotSettingsSub}>
                    {hasOverride ? 'このショット専用の設定を使用中' : '設定ページの値を使用中'}
                  </div>
                </div>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={!hasOverride}
                    onChange={e => handleToggleOverride(!e.target.checked)}
                  />
                  <span className={styles.toggleTrack} />
                </label>
              </div>

              {/* Per-shot controls — only shown when override is active */}
              {hasOverride && (
                <>
                  <div className={styles.shotSettingsRow}>
                    <div className={styles.shotSettingsLabel}>自動トリミング</div>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={effectiveTrimEnabled}
                        onChange={e => handleShotTrimEnabled(e.target.checked)}
                      />
                      <span className={styles.toggleTrack} />
                    </label>
                  </div>

                  <div className={`${styles.sliderGroup} ${!effectiveTrimEnabled ? styles.overrideDisabled : ''}`}>
                    <div className={styles.sliderGroupHeader}>
                      <div className={styles.shotSettingsLabel}>前後に残す時間</div>
                      <span className={styles.sliderValue}>{effectiveTrimPadding.toFixed(1)}秒</span>
                    </div>
                    <input
                      type="range"
                      className={styles.shotSlider}
                      min={0.2}
                      max={2.0}
                      step={0.1}
                      value={effectiveTrimPadding}
                      onChange={e => handleShotTrimPadding(parseFloat(e.target.value))}
                      disabled={!effectiveTrimEnabled}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Camera + controls — bottom */}
      <div className={styles.controls}>
        <CameraPreview videoRef={videoRef} />

        <div className={styles.buttons}>
          {state === 'idle' && (
            <>
              <button
                className={styles.recordBtn}
                onClick={handleRecord}
                disabled={!ready}
              >
                🔴 録画
              </button>
              <button
                className={styles.micRestartBtn}
                onClick={restartCamera}
              >
                🎙 マイク再接続
              </button>
            </>
          )}

          {state === 'recording' && (
            <button className={`${styles.recordBtn} ${styles.recording}`} onClick={handleStop}>
              ⏹ 停止
            </button>
          )}

          {state === 'remuxing' && (
            <div className={styles.remuxing}>
              🔄 変換中...
            </div>
          )}

          {state === 'stopped' && (
            <div className={styles.stoppedActions}>
              <button className={styles.playBtn} onClick={openModal} aria-label="録画を再生">
                ▶ 再生
              </button>
              <button className={styles.retryBtn} onClick={handleRetry}>
                もう一度
              </button>
              <button className={styles.nextBtn} onClick={handleNext}>
                {isLast ? '完了 ✓' : '次へ →'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Back navigation */}
      <button
        className={styles.backBtn}
        onClick={() => {
          if (state === 'recording') stopRecording()
          closeModal()
          navigate(`/scripts/${safeScript.id}/shots`)
        }}
      >
        ‹ 編集に戻る
      </button>

      {isReviewing && reviewUrl && (
        <VideoReviewModal url={reviewUrl} onClose={closeModal} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run build + tests**

```bash
cd teleprompter-app && npm run build 2>&1 | tail -15 && npm test 2>&1 | tail -15
```
Expected: no errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add teleprompter-app/src/pages/RecordPage.tsx teleprompter-app/src/pages/RecordPage.module.css
git commit -m "feat: add per-shot trim override UI to RecordPage"
```

---

## Final Verification

- [ ] Run full build one last time: `cd teleprompter-app && npm run build`
- [ ] Run all tests: `cd teleprompter-app && npm test`
- [ ] Manual check on iPhone (iOS Safari): record a shot with trim off → confirm full silence is kept
- [ ] Manual check: set padding to 1.0s → record → confirm ~1s padding retained
- [ ] Manual check: set per-shot override → press もう一度 → navigate away and back → confirm override fields are still in `teleprompter_scripts` in localStorage
- [ ] Manual check: set per-shot override on shot 1 → navigate to shot 2 → confirm shot 2 still shows global settings (no bleed-over from shot 1's override)
