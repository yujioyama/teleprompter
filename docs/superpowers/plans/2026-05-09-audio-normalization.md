# Audio Normalization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-out audio loudness normalization toggle (default on) that targets −14 LUFS via FFmpeg's loudnorm filter, applied in the existing remux pass.

**Architecture:** Five files need touching in dependency order: settings → remuxMp4 → useRecorder → RecordPage → SettingsPage. Each task is independently committable. No new files needed.

**Tech Stack:** TypeScript, React, Vitest, FFmpeg WASM (`@ffmpeg/ffmpeg`)

**Spec:** `docs/superpowers/specs/2026-05-09-audio-normalization-design.md`

**Baseline:** `npm test` → 32 tests pass before any changes.

---

## Chunk 1: Settings and FFmpeg core

### Task 1: Add `normalizeAudio` to `useSettings`

**Files:**
- Modify: `src/hooks/useSettings.ts`
- Modify: `src/hooks/useSettings.test.ts`

- [ ] **Step 1: Add failing tests for `normalizeAudio`**

  Open `src/hooks/useSettings.test.ts`. The existing test on line 12 checks defaults exactly — it will fail once the new field is added. Also add two new tests below the existing ones:

  ```ts
  // Replace line 12 with this (adds normalizeAudio to the expected object):
  expect(result.current[0]).toEqual({
    trimEnabled: true,
    trimPaddingStart: 0.5,
    trimPaddingEnd: 0.8,
    normalizeAudio: true,
  })
  ```

  Add at the bottom of the describe block (before the closing `}`):

  ```ts
  it('normalizeAudio defaults to true', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current[0].normalizeAudio).toBe(true)
  })

  it('updates normalizeAudio', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ normalizeAudio: false }) })
    expect(result.current[0].normalizeAudio).toBe(false)
    expect(result.current[0].trimEnabled).toBe(true) // unchanged
  })

  it('existing stored data without normalizeAudio gets default true', () => {
    localStorage.setItem(
      'teleprompter_settings',
      JSON.stringify({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2 }),
    )
    const { result } = renderHook(() => useSettings())
    expect(result.current[0].normalizeAudio).toBe(true)
    expect(result.current[0].trimEnabled).toBe(false) // old value preserved
  })
  ```

  Also update the `loads persisted settings on mount` test (line 46-53) to include `normalizeAudio`:
  ```ts
  localStorage.setItem(
    'teleprompter_settings',
    JSON.stringify({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2, normalizeAudio: false }),
  )
  const { result } = renderHook(() => useSettings())
  expect(result.current[0]).toEqual({
    trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2, normalizeAudio: false,
  })
  ```

  Also update the `falls back to defaults when localStorage contains invalid JSON` test (lines 56-59). Replace the `toEqual` line to include `normalizeAudio: true`:

  ```ts
  it('falls back to defaults when localStorage contains invalid JSON', () => {
    localStorage.setItem('teleprompter_settings', 'not-json')
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({
      trimEnabled: true,
      trimPaddingStart: 0.5,
      trimPaddingEnd: 0.8,
      normalizeAudio: true,
    })
  })
  ```

- [ ] **Step 2: Run tests — confirm failures**

  ```bash
  npm test -- --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|✓|✗|×)"
  ```

  Expected: several failures in `useSettings.test.ts` because `normalizeAudio` is not in the type yet.

- [ ] **Step 3: Implement `normalizeAudio` in `useSettings.ts`**

  ```ts
  // src/hooks/useSettings.ts
  export interface AppSettings {
    trimEnabled: boolean
    trimPaddingStart: number
    trimPaddingEnd: number
    normalizeAudio: boolean   // NEW
  }

  const DEFAULTS: AppSettings = {
    trimEnabled: true,
    trimPaddingStart: 0.5,
    trimPaddingEnd: 0.8,
    normalizeAudio: true,     // NEW — on by default
  }
  ```

  (The `loadSettings` and `useSettings` functions need no other changes — the `{ ...DEFAULTS, ...JSON.parse(raw) }` merge already handles old stored data.)

- [ ] **Step 4: Run tests — confirm all pass**

  ```bash
  npm test
  ```

  Expected: all tests pass (was 32, now 35).

- [ ] **Step 5: Commit**

  ```bash
  git add src/hooks/useSettings.ts src/hooks/useSettings.test.ts
  git commit -m "feat: add normalizeAudio setting (default true)"
  ```

---

### Task 2: Add `normalize` option to `remuxMp4`

**Files:**
- Modify: `src/utils/remuxMp4.ts`

No automated tests for FFmpeg WASM — manual verification at the end of the plan.

- [ ] **Step 1: Update `RemuxOptions` and function signature**

  In `src/utils/remuxMp4.ts`, change the interface and destructuring:

  ```ts
  interface RemuxOptions {
    trim?: { start: number; end: number }
    normalize?: boolean   // NEW
  }

  export async function remuxMp4(
    blob: Blob,
    { trim, normalize }: RemuxOptions = {},   // add normalize
  ): Promise<{ blob: Blob; ok: boolean; error?: string }> {
  ```

- [ ] **Step 2: Replace codec args — remove `-shortest`, add loudnorm branch**

  Find the line that currently reads:
  ```ts
  args.push('-c', 'copy', '-movflags', '+faststart', '-shortest', 'out.mp4')
  ```

  Replace it with:
  ```ts
  if (normalize) {
    // Re-encode audio with loudnorm; video is still stream-copied.
    // -af must come after -i. -shortest is omitted: the AAC encoder's ~23 ms
    // delay would cause premature truncation, and -t already caps the duration.
    args.push(
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-af', 'loudnorm=I=-14:LRA=11:TP=-1',
      '-movflags', '+faststart',
      'out.mp4',
    )
  } else {
    // Stream-copy both streams. -shortest removed: -t duration cap is sufficient.
    args.push('-c', 'copy', '-movflags', '+faststart', 'out.mp4')
  }
  ```

- [ ] **Step 3: Run tests — confirm nothing broken**

  ```bash
  npm test
  ```

  Expected: all 35 tests still pass (remuxMp4 has no unit tests).

- [ ] **Step 4: Commit**

  ```bash
  git add src/utils/remuxMp4.ts
  git commit -m "feat: add normalize option to remuxMp4 (loudnorm -14 LUFS)"
  ```

---

## Chunk 2: Wiring and UI

### Task 3: Thread `normalizeAudio` through `useRecorder`

**Files:**
- Modify: `src/hooks/useRecorder.ts`

- [ ] **Step 1: Add `normalizeAudio` to `ShotTrimSettings` interface**

  ```ts
  export interface ShotTrimSettings {
    trimEnabled: boolean
    trimPaddingStart: number
    trimPaddingEnd: number
    normalizeAudio: boolean   // NEW
  }
  ```

- [ ] **Step 2: Pass `normalize` to `remuxMp4`**

  Find the `remuxMp4` call inside `recorder.onstop`:

  ```ts
  const result = await remuxMp4(raw, { trim: trim ?? undefined })
  ```

  Change to:

  ```ts
  const result = await remuxMp4(raw, {
    trim: trim ?? undefined,
    normalize: shotSettings.normalizeAudio,
  })
  ```

- [ ] **Step 3: Run tests — confirm nothing broken**

  ```bash
  npm test
  ```

  Expected: all 35 tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/hooks/useRecorder.ts
  git commit -m "feat: thread normalizeAudio from ShotTrimSettings to remuxMp4"
  ```

---

### Task 4: Pass `normalizeAudio` from `RecordPage`

**Files:**
- Modify: `src/pages/RecordPage.tsx` (line 118)

- [ ] **Step 1: Update `startRecording` call**

  Find line 118:
  ```ts
  startRecording(stream, { trimEnabled: effectiveTrimEnabled, trimPaddingStart: effectiveTrimPaddingStart, trimPaddingEnd: effectiveTrimPaddingEnd })
  ```

  Change to:
  ```ts
  startRecording(stream, {
    trimEnabled: effectiveTrimEnabled,
    trimPaddingStart: effectiveTrimPaddingStart,
    trimPaddingEnd: effectiveTrimPaddingEnd,
    normalizeAudio: globalSettings.normalizeAudio,
  })
  ```

  Note: `normalizeAudio` is always taken from `globalSettings` (no per-shot override for this setting).

- [ ] **Step 2: Run tests — confirm nothing broken**

  ```bash
  npm test
  ```

  Expected: all 35 tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add src/pages/RecordPage.tsx
  git commit -m "feat: pass normalizeAudio from global settings to startRecording"
  ```

---

### Task 5: Add normalization toggle to `SettingsPage`

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add the "音声" section above "自動トリミング"**

  Find the opening of the first `<div className={styles.section}>` (currently the trim section). Insert a new section **before** it:

  ```tsx
  <div className={styles.section}>
    <div className={styles.sectionTitle}>音声</div>

    <div className={styles.row}>
      <div>
        <div className={styles.rowLabel}>音量の自動調整</div>
        <div className={styles.rowSub}>SNS投稿に最適な音量に自動調整します</div>
      </div>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={settings.normalizeAudio}
          onChange={e => updateSettings({ normalizeAudio: e.target.checked })}
        />
        <span className={styles.toggleTrack} />
      </label>
    </div>
  </div>
  ```

  All CSS classes (`styles.section`, `styles.sectionTitle`, `styles.row`, `styles.rowLabel`, `styles.rowSub`, `styles.toggle`, `styles.toggleTrack`) already exist from the trim section — no new CSS needed.

- [ ] **Step 2: Run tests — confirm nothing broken**

  ```bash
  npm test
  ```

  Expected: all 35 tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add src/pages/SettingsPage.tsx
  git commit -m "feat: add audio normalization toggle to SettingsPage"
  ```

- [ ] **Step 4: Push and verify on device**

  ```bash
  git push
  ```

  On iPhone (after Vercel deploys, ~1-2 min):
  1. Open the app → 設定 → confirm "音声" section appears above "自動トリミング" with toggle ON
  2. Record a 5-second clip
  3. Check browser console: `[remuxMp4] exec args:` should include `-c:v copy -c:a aac -af loudnorm=I=-14:LRA=11:TP=-1`
  4. Play back — audio should be noticeably louder/more consistent
  5. Toggle normalization OFF in settings, record again
  6. Check console: args should show `-c copy` (no loudnorm)
