# Asymmetric Trim Padding + Save Flow Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `trimPadding` into separate start/end padding values, and fix the save flow so cancelling the iOS share sheet no longer discards the recording.

**Architecture:** Changes flow from data types outward — update `types.ts` and `useSettings.ts` first (the source of truth), then the utility function `detectSpeechBounds.ts`, then the recorder hook `useRecorder.ts`, then the two UI pages. The save flow fix is entirely within `useRecorder.ts` and `RecordPage.tsx`. All changes are purely additive renames with no database/storage migration needed.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, CSS Modules. Test runner: `npm test` (vitest run). Build check: `npm run build` (tsc -b && vite build).

---

## Chunk 1: Data Layer

### Task 1: Update data types

**Files:**
- Modify: `teleprompter-app/src/types.ts`
- Modify: `teleprompter-app/src/hooks/useSettings.ts`

These are the source-of-truth definitions. Every other file in the codebase depends on them. Change them first so TypeScript immediately flags all downstream call sites that need updating.

- [ ] **Step 1.1: Update `Shot` interface in `types.ts`**

  Open `teleprompter-app/src/types.ts`. Find the `Shot` interface. Replace the `trimPadding?` field with two new fields:

  ```ts
  // Remove this line:
  trimPadding?: number
  // Add these two lines in its place:
  trimPaddingStart?: number
  trimPaddingEnd?: number
  ```

- [ ] **Step 1.2: Update `AppSettings` interface and defaults in `useSettings.ts`**

  Open `teleprompter-app/src/hooks/useSettings.ts`. Make three changes:

  1. In the `AppSettings` interface, replace:
     ```ts
     trimPadding: number
     ```
     with:
     ```ts
     trimPaddingStart: number
     trimPaddingEnd: number
     ```

  2. In the `DEFAULTS` constant, replace:
     ```ts
     const DEFAULTS: AppSettings = { trimEnabled: true, trimPadding: 0.5 }
     ```
     with:
     ```ts
     const DEFAULTS: AppSettings = { trimEnabled: true, trimPaddingStart: 0.5, trimPaddingEnd: 0.8 }
     ```

  The `loadSettings` function body (`{ ...DEFAULTS, ...JSON.parse(raw) }`) does not need any changes. Old localStorage data with a `trimPadding` key will harmlessly remain as a runtime orphan but won't affect behavior since `AppSettings` no longer declares it.

- [ ] **Step 1.3: Verify TypeScript errors appear**

  Run:
  ```bash
  cd teleprompter-app && npm run build 2>&1 | head -40
  ```
  Expected: TypeScript errors mentioning `trimPadding` in `useSettings.test.ts`, `useRecorder.ts`, `SettingsPage.tsx`, `RecordPage.tsx`. This confirms the rename is properly propagating. Do not fix these yet — they are addressed in subsequent tasks.

---

### Task 2: Update `useSettings` tests

**Files:**
- Modify: `teleprompter-app/src/hooks/useSettings.test.ts`

The test file has 6 existing tests, all referencing the deleted `trimPadding` field. After updates: the single "updates trimPadding" test splits into two ("updates trimPaddingStart" + "updates trimPaddingEnd"), and a new 8th test is added for old-format localStorage data. Result: 8 tests total.

- [ ] **Step 2.1: Run the tests to see the current failures**

  ```bash
  cd teleprompter-app && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|trimPadding"
  ```
  Expected: multiple test failures mentioning `trimPadding`.

- [ ] **Step 2.2: Rewrite `useSettings.test.ts` with all updated tests**

  Replace the entire contents of `teleprompter-app/src/hooks/useSettings.test.ts` with:

  ```ts
  import { renderHook, act } from '@testing-library/react'
  import { describe, it, expect, beforeEach } from 'vitest'
  import { useSettings } from './useSettings'

  beforeEach(() => {
    localStorage.clear()
  })

  describe('useSettings', () => {
    it('returns defaults when localStorage is empty', () => {
      const { result } = renderHook(() => useSettings())
      expect(result.current[0]).toEqual({ trimEnabled: true, trimPaddingStart: 0.5, trimPaddingEnd: 0.8 })
    })

    it('updates trimEnabled', () => {
      const { result } = renderHook(() => useSettings())
      act(() => {
        result.current[1]({ trimEnabled: false })
      })
      expect(result.current[0].trimEnabled).toBe(false)
      expect(result.current[0].trimPaddingStart).toBe(0.5) // unchanged
      expect(result.current[0].trimPaddingEnd).toBe(0.8) // unchanged
    })

    it('updates trimPaddingStart', () => {
      const { result } = renderHook(() => useSettings())
      act(() => { result.current[1]({ trimPaddingStart: 1.2 }) })
      expect(result.current[0].trimPaddingStart).toBe(1.2)
      expect(result.current[0].trimEnabled).toBe(true) // unchanged
    })

    it('updates trimPaddingEnd', () => {
      const { result } = renderHook(() => useSettings())
      act(() => { result.current[1]({ trimPaddingEnd: 1.5 }) })
      expect(result.current[0].trimPaddingEnd).toBe(1.5)
      expect(result.current[0].trimEnabled).toBe(true) // unchanged
    })

    it('persists to localStorage', () => {
      const { result } = renderHook(() => useSettings())
      act(() => { result.current[1]({ trimPaddingEnd: 1.0 }) })
      const raw = localStorage.getItem('teleprompter_settings')
      expect(JSON.parse(raw!).trimPaddingEnd).toBe(1.0)
    })

    it('loads persisted settings on mount', () => {
      localStorage.setItem(
        'teleprompter_settings',
        JSON.stringify({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2 })
      )
      const { result } = renderHook(() => useSettings())
      expect(result.current[0]).toEqual({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2 })
    })

    it('falls back to defaults when localStorage contains invalid JSON', () => {
      localStorage.setItem('teleprompter_settings', 'not-json')
      const { result } = renderHook(() => useSettings())
      expect(result.current[0]).toEqual({ trimEnabled: true, trimPaddingStart: 0.5, trimPaddingEnd: 0.8 })
    })

    it('uses defaults for new fields when loading old-format data', () => {
      localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false, trimPadding: 1.0 }))
      const { result } = renderHook(() => useSettings())
      // trimEnabled is preserved from old data; new fields fall back to DEFAULTS
      expect(result.current[0].trimEnabled).toBe(false)
      expect(result.current[0].trimPaddingStart).toBe(0.5)
      expect(result.current[0].trimPaddingEnd).toBe(0.8)
    })
  })
  ```

- [ ] **Step 2.3: Run `useSettings` tests to confirm they pass**

  ```bash
  cd teleprompter-app && npm test -- useSettings --reporter=verbose
  ```
  Expected: 8 tests pass (`✓` for all).

---

### Task 3: Update `detectSpeechBounds.ts`

**Files:**
- Modify: `teleprompter-app/src/utils/detectSpeechBounds.ts`

This utility has no unit tests (AudioContext cannot be tested in jsdom). Changes are purely mechanical: split the single `padding` parameter into `paddingStart` and `paddingEnd`, and fix a misleading comment.

- [ ] **Step 3.1: Update function signature and body**

  Open `teleprompter-app/src/utils/detectSpeechBounds.ts`. Make these three changes:

  1. Change the function signature on line 14:
     ```ts
     // From:
     export async function detectSpeechBounds(blob: Blob, padding: number): Promise<SpeechBounds | null> {
     // To:
     export async function detectSpeechBounds(blob: Blob, paddingStart: number, paddingEnd: number): Promise<SpeechBounds | null> {
     ```

  2. Update the two lines that compute `start` and `end` (lines 63–64):
     ```ts
     // From:
     const start = Math.max(0, speechStart - padding)
     const end = Math.min(duration, speechEnd + padding)
     // To:
     const start = Math.max(0, speechStart - paddingStart)
     const end = Math.min(duration, speechEnd + paddingEnd)
     ```

  3. Fix the misleading comment on line 66:
     ```ts
     // From:
     // Skip trim if we'd cut less than 0.3 s total — not worth re-encoding
     // To:
     // Skip trim if speech fills nearly the whole clip — less than 0.1 s saved on each side
     ```

- [ ] **Step 3.2: Verify TypeScript compile for this file**

  ```bash
  cd teleprompter-app && npx tsc --noEmit 2>&1 | grep -v "node_modules"
  ```
  Expected: the only errors remaining are in `useRecorder.ts` (it still passes the old single `trimPadding` argument to `detectSpeechBounds`) and in the UI pages (not yet updated). There must be zero errors mentioning `detectSpeechBounds.ts` as the source file — errors about the call site in `useRecorder.ts` are expected and will be fixed in Task 4.

---

### Task 4: Update `useRecorder.ts`

**Files:**
- Modify: `teleprompter-app/src/hooks/useRecorder.ts`

Two independent changes in this file: (1) split `ShotTrimSettings.trimPadding`, and (2) change `shareOrDownload` to return `boolean`.

- [ ] **Step 4.1: Update `ShotTrimSettings` interface**

  In `teleprompter-app/src/hooks/useRecorder.ts`, replace the `ShotTrimSettings` interface:
  ```ts
  // From:
  export interface ShotTrimSettings {
    trimEnabled: boolean
    trimPadding: number
  }
  // To:
  export interface ShotTrimSettings {
    trimEnabled: boolean
    trimPaddingStart: number
    trimPaddingEnd: number
  }
  ```

- [ ] **Step 4.2: Update `detectSpeechBounds` call site in `onstop` handler**

  Find the line inside `recorder.onstop` (around line 70):
  ```ts
  trim = await detectSpeechBounds(raw, shotSettings.trimPadding)
  ```
  Replace with:
  ```ts
  trim = await detectSpeechBounds(raw, shotSettings.trimPaddingStart, shotSettings.trimPaddingEnd)
  ```

- [ ] **Step 4.3: Update `UseRecorderResult` interface — `shareOrDownload` return type**

  Find the `UseRecorderResult` interface. Change:
  ```ts
  shareOrDownload: (filename: string) => Promise<void>
  ```
  to:
  ```ts
  shareOrDownload: (filename: string) => Promise<boolean>
  ```

- [ ] **Step 4.4: Replace `shareOrDownload` function body**

  Find and replace the entire `shareOrDownload` function (currently lines 95–122) with the new implementation:

  ```ts
  async function shareOrDownload(filename: string): Promise<boolean> {
    if (!blobRef.current) return false

    const ext = getExtension(mimeTypeRef.current)
    const fullName = `${filename}.${ext}`
    const file = new File([blobRef.current], fullName, {
      type: mimeTypeRef.current || 'video/webm',
    })

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fullName })
        return true
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return false
        // Non-AbortError: share API failed for other reason — fall through to download fallback
      }
    }

    // Fallback: trigger download (always succeeds)
    const url = URL.createObjectURL(blobRef.current)
    const a = document.createElement('a')
    a.href = url
    a.download = fullName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
    return true
  }
  ```

  Key behavioral difference from the old code:
  - Old: `AbortError` caused an early `return` (void) — the download fallback was *also* skipped on AbortError
  - New: `AbortError` returns `false` (no download); non-AbortError falls through to download and returns `true`

- [ ] **Step 4.5: Verify TypeScript — `useRecorder.ts` errors should now be gone**

  ```bash
  cd teleprompter-app && npx tsc --noEmit 2>&1 | grep useRecorder
  ```
  Expected: no errors.

- [ ] **Step 4.6: Commit Chunk 1**

  ```bash
  cd teleprompter-app && git add src/types.ts src/hooks/useSettings.ts src/hooks/useSettings.test.ts src/utils/detectSpeechBounds.ts src/hooks/useRecorder.ts && git commit -m "feat: split trimPadding into trimPaddingStart/End; shareOrDownload returns boolean"
  ```

---

## Chunk 2: UI Layer

### Task 5: Update `SettingsPage.tsx`

**Files:**
- Modify: `teleprompter-app/src/pages/SettingsPage.tsx`

Replace the single「前後に残す時間」slider with two sliders.

- [ ] **Step 5.1: Replace the slider block in `SettingsPage.tsx`**

  Open `teleprompter-app/src/pages/SettingsPage.tsx`. Find the existing single slider block (lines 34–52):
  ```tsx
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
  ```

  Replace it with two blocks:
  ```tsx
  <div className={`${styles.row} ${styles.sliderRow} ${!settings.trimEnabled ? styles.disabled : ''}`}>
    <div className={styles.sliderHeader}>
      <div>
        <div className={styles.rowLabel}>前に残す時間</div>
        <div className={styles.rowSub}>音声の前に保持する無音の長さ</div>
      </div>
      <span className={styles.sliderValue}>{settings.trimPaddingStart.toFixed(1)}秒</span>
    </div>
    <input
      type="range"
      className={styles.slider}
      min={0.2}
      max={2.0}
      step={0.1}
      value={settings.trimPaddingStart}
      onChange={e => updateSettings({ trimPaddingStart: parseFloat(e.target.value) })}
      disabled={!settings.trimEnabled}
    />
  </div>

  <div className={`${styles.row} ${styles.sliderRow} ${!settings.trimEnabled ? styles.disabled : ''}`}>
    <div className={styles.sliderHeader}>
      <div>
        <div className={styles.rowLabel}>後ろに残す時間</div>
        <div className={styles.rowSub}>音声の後ろに保持する無音の長さ</div>
      </div>
      <span className={styles.sliderValue}>{settings.trimPaddingEnd.toFixed(1)}秒</span>
    </div>
    <input
      type="range"
      className={styles.slider}
      min={0.2}
      max={2.0}
      step={0.1}
      value={settings.trimPaddingEnd}
      onChange={e => updateSettings({ trimPaddingEnd: parseFloat(e.target.value) })}
      disabled={!settings.trimEnabled}
    />
  </div>
  ```

- [ ] **Step 5.2: Verify no TypeScript errors in SettingsPage**

  ```bash
  cd teleprompter-app && npx tsc --noEmit 2>&1 | grep SettingsPage
  ```
  Expected: no output (no errors).

---

### Task 6: Update `RecordPage.tsx`

**Files:**
- Modify: `teleprompter-app/src/pages/RecordPage.tsx`

This is the largest change. Work through the file top to bottom.

- [ ] **Step 6.1: Replace effective-settings variables (line 44)**

  Find line 44:
  ```ts
  const effectiveTrimPadding = currentShot?.trimPadding ?? globalSettings.trimPadding
  ```
  Replace with:
  ```ts
  const effectiveTrimPaddingStart = currentShot?.trimPaddingStart ?? globalSettings.trimPaddingStart
  const effectiveTrimPaddingEnd = currentShot?.trimPaddingEnd ?? globalSettings.trimPaddingEnd
  ```

- [ ] **Step 6.2: Update `hasOverride` (line 45)**

  Find:
  ```ts
  const hasOverride = currentShot?.trimEnabled !== undefined || currentShot?.trimPadding !== undefined
  ```
  Replace with:
  ```ts
  const hasOverride =
    currentShot?.trimEnabled !== undefined ||
    currentShot?.trimPaddingStart !== undefined ||
    currentShot?.trimPaddingEnd !== undefined
  ```

- [ ] **Step 6.3: Replace `handleNext` with `handleSaveAndNext` and `handleSkipAndNext`**

  Find and delete the entire `handleNext` function (lines 57–67):
  ```ts
  async function handleNext() {
    try {
      await shareOrDownload(getFilename())
    } catch {
      // save cancelled or failed — still advance
    }
    closeModal()
    reset()
    setShotSettingsOpen(false)
    setShotIndex(i => i + 1)
  }
  ```

  Replace it with:
  ```ts
  async function handleSaveAndNext() {
    const saved = await shareOrDownload(getFilename())
    if (!saved) return  // user cancelled — stay on current shot
    closeModal()
    reset()
    setShotSettingsOpen(false)
    setShotIndex(i => i + 1)
  }

  function handleSkipAndNext() {
    closeModal()
    reset()
    setShotSettingsOpen(false)
    setShotIndex(i => i + 1)
  }
  ```

- [ ] **Step 6.4: Update `handleRecord` call site**

  Find (around line 99):
  ```ts
  startRecording(stream, { trimEnabled: effectiveTrimEnabled, trimPadding: effectiveTrimPadding })
  ```
  Replace with:
  ```ts
  startRecording(stream, { trimEnabled: effectiveTrimEnabled, trimPaddingStart: effectiveTrimPaddingStart, trimPaddingEnd: effectiveTrimPaddingEnd })
  ```

- [ ] **Step 6.5: Update `handleToggleOverride`**

  Find the `handleToggleOverride` function body (around line 106):
  ```ts
  ? { ...s, trimEnabled: enabled ? globalSettings.trimEnabled : undefined, trimPadding: enabled ? globalSettings.trimPadding : undefined }
  ```
  Replace with:
  ```ts
  ? {
      ...s,
      trimEnabled: enabled ? globalSettings.trimEnabled : undefined,
      trimPaddingStart: enabled ? globalSettings.trimPaddingStart : undefined,
      trimPaddingEnd: enabled ? globalSettings.trimPaddingEnd : undefined,
    }
  ```

- [ ] **Step 6.6: Delete `handleShotTrimPadding`, add two replacements**

  Find and delete the entire `handleShotTrimPadding` function (lines 120–126):
  ```ts
  function handleShotTrimPadding(value: number) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, trimPadding: value } : s
    )
    updateScript(id, { shots: updatedShots })
  }
  ```

  Replace with:
  ```ts
  function handleShotTrimPaddingStart(value: number) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, trimPaddingStart: value } : s
    )
    updateScript(id, { shots: updatedShots })
  }

  function handleShotTrimPaddingEnd(value: number) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, trimPaddingEnd: value } : s
    )
    updateScript(id, { shots: updatedShots })
  }
  ```

  Note: `handleShotTrimEnabled` (the function directly above) is **retained unchanged**. Do not delete it.

- [ ] **Step 6.7: Replace single per-shot slider JSX with two sliders**

  In the per-shot settings panel JSX, find the single `.sliderGroup` block (lines 216–231):
  ```tsx
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
  ```

  Replace with:
  ```tsx
  <div className={`${styles.sliderGroup} ${!effectiveTrimEnabled ? styles.overrideDisabled : ''}`}>
    <div className={styles.sliderGroupHeader}>
      <div className={styles.shotSettingsLabel}>前に残す時間</div>
      <span className={styles.sliderValue}>{effectiveTrimPaddingStart.toFixed(1)}秒</span>
    </div>
    <input
      type="range"
      className={styles.shotSlider}
      min={0.2}
      max={2.0}
      step={0.1}
      value={effectiveTrimPaddingStart}
      onChange={e => handleShotTrimPaddingStart(parseFloat(e.target.value))}
      disabled={!effectiveTrimEnabled}
    />
  </div>

  <div className={`${styles.sliderGroup} ${!effectiveTrimEnabled ? styles.overrideDisabled : ''}`}>
    <div className={styles.sliderGroupHeader}>
      <div className={styles.shotSettingsLabel}>後ろに残す時間</div>
      <span className={styles.sliderValue}>{effectiveTrimPaddingEnd.toFixed(1)}秒</span>
    </div>
    <input
      type="range"
      className={styles.shotSlider}
      min={0.2}
      max={2.0}
      step={0.1}
      value={effectiveTrimPaddingEnd}
      onChange={e => handleShotTrimPaddingEnd(parseFloat(e.target.value))}
      disabled={!effectiveTrimEnabled}
    />
  </div>
  ```

- [ ] **Step 6.8: Replace stopped state buttons JSX**

  Find the stopped state block (lines 274–286):
  ```tsx
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
  ```

  Replace with:
  ```tsx
  {state === 'stopped' && (
    <div className={styles.stoppedActions}>
      <button className={styles.playBtn} onClick={openModal} aria-label="録画を再生">
        ▶ 再生
      </button>
      <button className={styles.retryBtn} onClick={handleRetry}>
        もう一度
      </button>
      <div className={styles.saveGroup}>
        <button className={styles.nextBtn} onClick={handleSaveAndNext}>
          {isLast ? '保存して完了 ✓' : '保存して次へ →'}
        </button>
        <button className={styles.skipBtn} onClick={handleSkipAndNext}>
          {isLast ? '保存せずに完了' : '保存せずに次へ'}
        </button>
      </div>
    </div>
  )}
  ```

- [ ] **Step 6.9: Verify no TypeScript errors in RecordPage**

  ```bash
  cd teleprompter-app && npx tsc --noEmit 2>&1 | grep RecordPage
  ```
  Expected: no output (no errors).

---

### Task 7: Update `RecordPage.module.css`

**Files:**
- Modify: `teleprompter-app/src/pages/RecordPage.module.css`

Four CSS changes: remove `.saveBtn`, add `.saveGroup`, update `.stoppedActions`, add `.skipBtn`.

- [ ] **Step 7.1: Remove the orphaned `.saveBtn` class**

  Find and delete the entire `.saveBtn` block (lines 121–128):
  ```css
  .saveBtn {
    background: var(--success);
    color: #000;
    padding: 10px 16px;
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 700;
  }
  ```

- [ ] **Step 7.2: Add `align-items: center` to `.stoppedActions`**

  Find the `.stoppedActions` block:
  ```css
  .stoppedActions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  ```
  Replace with:
  ```css
  .stoppedActions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
  }
  ```

- [ ] **Step 7.3: Add `.saveGroup` and `.skipBtn` after `.nextBtn`**

  Find the `.nextBtn` block (ends around line 156). After it, add:
  ```css
  .saveGroup {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .skipBtn {
    background: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 2px 4px;
  }
  ```

---

### Task 8: Final verification

- [ ] **Step 8.1: Run full test suite**

  ```bash
  cd teleprompter-app && npm test -- --reporter=verbose
  ```
  Expected: all tests pass. There are currently 4 test files (`useScripts`, `splitShots`, `mergeShots`, `useSettings`). All should show `✓`.

- [ ] **Step 8.2: Run full TypeScript + Vite build**

  ```bash
  cd teleprompter-app && npm run build 2>&1
  ```
  Expected: output ends with something like:
  ```
  ✓ built in Xs
  ```
  No TypeScript errors, no build errors.

- [ ] **Step 8.3: Commit Chunk 2**

  ```bash
  cd teleprompter-app && git add src/pages/SettingsPage.tsx src/pages/RecordPage.tsx src/pages/RecordPage.module.css && git commit -m "feat: split padding sliders; add save/skip buttons in stopped state"
  ```

---

## Manual Verification Checklist (on device)

After deploying to Vercel (or running `npm run dev` locally):

1. Open `/settings` — confirm two sliders: 「前に残す時間」(default 0.5s) and「後ろに残す時間」(default 0.8s). Both disable when auto-trim is off.
2. Open RecordPage → open shot settings → enable per-shot override → confirm two sliders appear with independent values.
3. Record a shot on iOS Safari → press「保存して次へ →」→ cancel the share sheet → confirm the app stays on the stopped state (does not advance).
4. Press「保存して次へ →」again → complete the share → confirm the app advances to the next shot.
5. Press「保存せずに次へ」→ confirm the app advances immediately without opening the share sheet.
6. On the last shot, confirm the primary button shows「保存して完了 ✓」and the skip link shows「保存せずに完了」.
7. Cancel share on the last shot → confirm the completion screen does not appear.
8. Clear localStorage and reload → confirm default values are trimPaddingStart=0.5, trimPaddingEnd=0.8.
