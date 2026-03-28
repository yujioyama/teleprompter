# Asymmetric Trim Padding + Save Flow Fix Design

**Date:** 2026-03-28

## Context

Two improvements to the recording flow:

1. **Asymmetric padding:** The current single `trimPadding` value is split into separate start/end values. Speech tends to trail off at the end of sentences, so end padding needs to be longer than start padding to avoid cutting off the last words.

2. **Save flow fix:** Currently, pressing「次へ」opens the iOS share sheet. If the user accidentally cancels the share sheet, the app advances to the next shot anyway and the recording is lost. Add explicit「保存して次へ」and「保存せずに次へ」actions.

---

## Change 1: Asymmetric Trim Padding

### Data Model

#### `types.ts` — Shot field rename
```ts
interface Shot {
  id: string
  text: string
  trimEnabled?: boolean
  trimPaddingStart?: number  // replaces trimPadding
  trimPaddingEnd?: number    // replaces trimPadding
}
```

#### `useSettings.ts` — AppSettings field rename
```ts
interface AppSettings {
  trimEnabled: boolean
  trimPaddingStart: number  // replaces trimPadding, default: 0.5
  trimPaddingEnd: number    // replaces trimPadding, default: 0.8
}
const DEFAULTS: AppSettings = { trimEnabled: true, trimPaddingStart: 0.5, trimPaddingEnd: 0.8 }
```

#### `useRecorder.ts` — ShotTrimSettings field rename
```ts
export interface ShotTrimSettings {
  trimEnabled: boolean
  trimPaddingStart: number  // replaces trimPadding
  trimPaddingEnd: number    // replaces trimPadding
}
```

No migration needed — existing localStorage data simply falls back to new defaults on load (no `trimPaddingStart`/`trimPaddingEnd` keys will be found, so DEFAULTS are used). The old `trimPadding` key from legacy data will persist as an extra property at runtime, but since `AppSettings` no longer declares it, TypeScript will not expose it and it will not affect behavior. The `loadSettings` function does not need to strip it — the spread pattern `{ ...DEFAULTS, ...JSON.parse(raw) }` is correct as-is.

### `detectSpeechBounds.ts`
- Signature: `detectSpeechBounds(blob: Blob, paddingStart: number, paddingEnd: number)`
- `const start = Math.max(0, speechStart - paddingStart)`
- `const end = Math.min(duration, speechEnd + paddingEnd)`
- The internal skip-trim guard (`if (savedStart < 0.1 && savedEnd < 0.1) return null`) remains unchanged. `savedStart = start = Math.max(0, speechStart - paddingStart)` and `savedEnd = duration - end`. Since `end` is already clamped by `Math.min(duration, ...)`, `savedEnd` cannot go negative; it will be near zero only when speech genuinely fills the clip to the end. The guard behavior is correct for the asymmetric case without modification.
- Also fix the misleading comment on line 66: change `// Skip trim if we'd cut less than 0.3 s total — not worth re-encoding` to `// Skip trim if speech fills nearly the whole clip — less than 0.1 s saved on each side`

### `useRecorder.ts` — call sites update

**`onstop` handler** — update `detectSpeechBounds` call:
```ts
// From:
trim = await detectSpeechBounds(raw, shotSettings.trimPadding)
// To:
trim = await detectSpeechBounds(raw, shotSettings.trimPaddingStart, shotSettings.trimPaddingEnd)
```

**`UseRecorderResult` interface** — update `shareOrDownload` return type (covered in Change 2 below) and note that the `ShotTrimSettings` rename means `startRecording`'s signature in the interface is automatically updated since it references the renamed type.

### SettingsPage

Replace the single「前後に残す時間」slider row with two slider rows. The existing slider row block:
```tsx
<div className={`${styles.row} ${styles.sliderRow} ${!settings.trimEnabled ? styles.disabled : ''}`}>
  <div className={styles.sliderHeader}>
    <div>
      <div className={styles.rowLabel}>前後に残す時間</div>
      <div className={styles.rowSub}>音声の前後に保持する無音の長さ</div>
    </div>
    <span className={styles.sliderValue}>{settings.trimPadding.toFixed(1)}秒</span>
  </div>
  <input ... value={settings.trimPadding} onChange={e => updateSettings({ trimPadding: parseFloat(e.target.value) })} ... />
</div>
```

Becomes two blocks:
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
    min={0.2} max={2.0} step={0.1}
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
    min={0.2} max={2.0} step={0.1}
    value={settings.trimPaddingEnd}
    onChange={e => updateSettings({ trimPaddingEnd: parseFloat(e.target.value) })}
    disabled={!settings.trimEnabled}
  />
</div>
```

Both sliders are disabled when `trimEnabled` is false (same pattern as existing).

### RecordPage per-shot override

Remove the old `effectiveTrimPadding` variable and replace with two:
```ts
// Remove:
const effectiveTrimPadding = currentShot?.trimPadding ?? globalSettings.trimPadding
// Add:
const effectiveTrimPaddingStart = currentShot?.trimPaddingStart ?? globalSettings.trimPaddingStart
const effectiveTrimPaddingEnd = currentShot?.trimPaddingEnd ?? globalSettings.trimPaddingEnd
```

`hasOverride` updates to:
```ts
const hasOverride =
  currentShot?.trimEnabled !== undefined ||
  currentShot?.trimPaddingStart !== undefined ||
  currentShot?.trimPaddingEnd !== undefined
```

`handleToggleOverride` seeds all three fields when enabling override:
```ts
function handleToggleOverride(enabled: boolean) {
  if (!currentShot || !id) return
  const updatedShots = safeScript.shots.map(s =>
    s.id === currentShot.id
      ? {
          ...s,
          trimEnabled: enabled ? globalSettings.trimEnabled : undefined,
          trimPaddingStart: enabled ? globalSettings.trimPaddingStart : undefined,
          trimPaddingEnd: enabled ? globalSettings.trimPaddingEnd : undefined,
        }
      : s
  )
  updateScript(id, { shots: updatedShots })
}
```

Delete `handleShotTrimPadding` entirely and replace with two handlers. Note: `handleShotTrimEnabled` (which updates the `trimEnabled` field on a shot) is retained unchanged — do not delete it.
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

Replace the single slider JSX block with two sliders:
```tsx
<div className={`${styles.sliderGroup} ${!effectiveTrimEnabled ? styles.overrideDisabled : ''}`}>
  <div className={styles.sliderGroupHeader}>
    <div className={styles.shotSettingsLabel}>前に残す時間</div>
    <span className={styles.sliderValue}>{effectiveTrimPaddingStart.toFixed(1)}秒</span>
  </div>
  <input
    type="range"
    className={styles.shotSlider}
    min={0.2} max={2.0} step={0.1}
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
    min={0.2} max={2.0} step={0.1}
    value={effectiveTrimPaddingEnd}
    onChange={e => handleShotTrimPaddingEnd(parseFloat(e.target.value))}
    disabled={!effectiveTrimEnabled}
  />
</div>
```

`handleRecord` call site — update to pass split fields:
```ts
// From:
startRecording(stream, { trimEnabled: effectiveTrimEnabled, trimPadding: effectiveTrimPadding })
// To:
startRecording(stream, { trimEnabled: effectiveTrimEnabled, trimPaddingStart: effectiveTrimPaddingStart, trimPaddingEnd: effectiveTrimPaddingEnd })
```

---

## Change 2: Save Flow Fix

### `useRecorder.ts` — shareOrDownload return type

Change `shareOrDownload` in both the `UseRecorderResult` interface and the function implementation from `Promise<void>` to `Promise<boolean>`:
- Returns `true` if the file was successfully shared/downloaded
- Returns `false` if the user cancelled the share sheet (AbortError) or if there was no blob

```ts
// In UseRecorderResult interface:
shareOrDownload: (filename: string) => Promise<boolean>  // was Promise<void>
```

Implementation (replaces the existing `shareOrDownload` function body):
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

Note: only `AbortError` (user cancelled share sheet) returns `false`. A non-AbortError share failure falls through to the download path and returns `true`. This ensures that if the Web Share API throws unexpectedly, the user still gets a file download rather than losing their recording. This differs from the old behavior which had `if (err instanceof DOMException && err.name === 'AbortError') return` (an early `void` return that prevented the download fallback on abort) — the new code correctly separates the abort case (return false, no download) from other failures (fall through to download, return true).

### RecordPage — stopped state buttons

Replace the current single「次へ →」button with two actions. Remove the old `handleNext` function entirely and replace with `handleSaveAndNext` and `handleSkipAndNext`.

The new JSX structure for the stopped state:
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

The existing `.nextBtn` style is reused as-is for the primary save button (no style changes needed).

**「保存して次へ」** (primary button, `.nextBtn` style):
- Label: `isLast ? '保存して完了 ✓' : '保存して次へ →'`
- Calls `shareOrDownload`; only advances if it returns `true`
- If `false` (cancelled): stays on current shot in stopped state

**「保存せずに次へ」** (secondary, `.skipBtn` style — small plain text link):
- Label: `isLast ? '保存せずに完了' : '保存せずに次へ'`
- Skips saving and advances immediately

### RecordPage handlers

Delete the old `handleNext` function (which had a try/catch that always advanced) and add:

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

Note: the old `handleNext` wrapped `shareOrDownload` in a try/catch and always advanced regardless of the result. The new `handleSaveAndNext` intentionally removes that try/catch — the `if (!saved) return` early exit is the correct behavior, and errors from the download fallback path are extremely unlikely (URL.createObjectURL doesn't throw in practice).

Both handlers unconditionally call `setShotIndex(i => i + 1)` when they do advance. The completion screen is triggered by `isComplete = shotIndex >= safeScript.shots.length`, evaluated at render time — same as the existing pattern.

`getFilename()` is defined as a plain function inside the component and remains in scope for both handlers with no changes needed.

### CSS changes — `RecordPage.module.css`

1. **Remove** the orphaned `.saveBtn` class (currently lines 121–128).

2. **Add** `.saveGroup` for vertical stacking of the primary button + skip link:
```css
.saveGroup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
```

3. **Update** `.stoppedActions` to add `align-items: center` for proper vertical alignment with the new saveGroup:
```css
.stoppedActions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
}
```

4. **Add** `.skipBtn` styled as a small plain text link to discourage accidental taps:
```css
.skipBtn {
  background: none;
  color: var(--text-muted);
  font-size: 0.75rem;
  padding: 2px 4px;
}
```

---

## `useSettings.test.ts` — Required Changes

The following specific changes are needed in `useSettings.test.ts`:

1. **Line 12** — default assertion:
   ```ts
   // From:
   expect(result.current[0]).toEqual({ trimEnabled: true, trimPadding: 0.5 })
   // To:
   expect(result.current[0]).toEqual({ trimEnabled: true, trimPaddingStart: 0.5, trimPaddingEnd: 0.8 })
   ```

2. **Line 21** — "updates trimEnabled" test, unchanged-field assertion:
   ```ts
   // From:
   expect(result.current[0].trimPadding).toBe(0.5) // unchanged
   // To:
   expect(result.current[0].trimPaddingStart).toBe(0.5) // unchanged
   expect(result.current[0].trimPaddingEnd).toBe(0.8) // unchanged
   ```

3. **Lines 24–31** — replace the "updates trimPadding" test with two tests:
   ```ts
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
   ```

4. **Lines 33–40** — "persists to localStorage" test:
   ```ts
   // From:
   act(() => { result.current[1]({ trimPadding: 0.8 }) })
   expect(JSON.parse(raw!).trimPadding).toBe(0.8)
   // To:
   act(() => { result.current[1]({ trimPaddingEnd: 1.0 }) })
   expect(JSON.parse(raw!).trimPaddingEnd).toBe(1.0)
   ```

5. **Lines 42–46** — "loads persisted settings on mount" test:
   ```ts
   // From:
   localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false, trimPadding: 1.0 }))
   expect(result.current[0]).toEqual({ trimEnabled: false, trimPadding: 1.0 })
   // To:
   localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2 }))
   expect(result.current[0]).toEqual({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2 })
   ```

6. **Lines 48–52** — "falls back to defaults when localStorage contains invalid JSON" test:
   ```ts
   // From:
   expect(result.current[0]).toEqual({ trimEnabled: true, trimPadding: 0.5 })
   // To:
   expect(result.current[0]).toEqual({ trimEnabled: true, trimPaddingStart: 0.5, trimPaddingEnd: 0.8 })
   ```

7. **Add new test** — "uses defaults for new fields when loading old-format data":
   ```ts
   it('uses defaults for new fields when loading old-format data', () => {
     localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false, trimPadding: 1.0 }))
     const { result } = renderHook(() => useSettings())
     // trimEnabled is preserved from old data; new fields fall back to DEFAULTS
     expect(result.current[0].trimEnabled).toBe(false)
     expect(result.current[0].trimPaddingStart).toBe(0.5)
     expect(result.current[0].trimPaddingEnd).toBe(0.8)
   })
   ```
   Note: the old `trimPadding` key persists in the runtime object but is not exposed by the `AppSettings` type. We use field-by-field assertions (not `toEqual`) to avoid false failures from the extra key.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/types.ts` | `trimPadding?` → `trimPaddingStart?` + `trimPaddingEnd?` |
| `src/hooks/useSettings.ts` | `trimPadding` → `trimPaddingStart` + `trimPaddingEnd`, new defaults |
| `src/hooks/useSettings.test.ts` | Update all 6 tests per the detailed changes above |
| `src/utils/detectSpeechBounds.ts` | `padding` → `paddingStart` + `paddingEnd`; fix misleading comment on line 66 |
| `src/hooks/useRecorder.ts` | `ShotTrimSettings`: split field; update `detectSpeechBounds` call site; `UseRecorderResult` interface + `shareOrDownload` implementation: returns `boolean` |
| `src/pages/SettingsPage.tsx` | Split single slider into two slider rows (前に残す時間 / 後ろに残す時間) |
| `src/pages/RecordPage.tsx` | Remove `effectiveTrimPadding`; add `effectiveTrimPaddingStart` + `effectiveTrimPaddingEnd`; update `hasOverride`; update `handleToggleOverride` to seed 3 fields; delete `handleShotTrimPadding` and add `handleShotTrimPaddingStart` + `handleShotTrimPaddingEnd`; update `handleRecord` `startRecording` call; delete `handleNext` and add `handleSaveAndNext` + `handleSkipAndNext`; update stopped state JSX with two buttons + `.saveGroup` wrapper |
| `src/pages/RecordPage.module.css` | Remove orphaned `.saveBtn`; add `.saveGroup`; update `.stoppedActions` to add `align-items: center`; add `.skipBtn` |

---

## Verification

1. `npm run build` passes with no TypeScript errors
2. `npm test` — all tests pass (update useSettings tests for new field names)
3. **Asymmetric padding (iOS Safari):** Set start=0.3s, end=1.5s → record → check waveform in audio editor (e.g. Audacity) or listen carefully that start is tight and end has comfortable buffer
4. **Save flow — cancel:** On iOS, press「保存して次へ」→ cancel share sheet → confirm app stays on current stopped state (does not advance)
5. **Save flow — complete:** Press「保存して次へ」→ complete share → confirm advances to next shot
6. **Skip flow:** Press「保存せずに次へ」→ confirm advances immediately without opening share sheet
7. **Last shot labels:** On the final shot, verify primary button shows「保存して完了 ✓」and skip shows「保存せずに完了」
8. **Cancel on last shot:** On the final shot, press「保存して完了 ✓」→ cancel share sheet → confirm app stays on current stopped state (does not advance to completion screen)
9. **Per-shot override:** Set asymmetric per-shot values → confirm they persist and override global for that shot only
10. **Old localStorage data:** Clear localStorage → confirm defaults are trimPaddingStart=0.5, trimPaddingEnd=0.8
