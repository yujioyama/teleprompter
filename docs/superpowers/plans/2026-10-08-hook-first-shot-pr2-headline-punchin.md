# Hook on the First Shot — PR 2: Headline, First-Shot Lead-in, Punch-in

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the first-shot hook (items 4–6 of the spec):
- an optional on-screen headline above the hook subtitle during the first shot;
- a near-zero silence lead-in before the first shot's speech;
- a slow 1.0 → 1.08 zoom on the first shot's picture, with the subtitles unzoomed.

**Architecture:** Builds on PR 1 (`styleCues`, `HookOptions`, `SubtitleLook`, the variant layout).
- `HookOptions` gains `headline` and `punchIn`. Both apply only to a video that starts with the first shot (`SubtitleLook.firstShotDuration !== null`): the whole joined video, or shot 0's own clip.
- The headline is one more PNG overlay over `[0, D)`, placed above the topmost first-shot cue box.
- The punch-in is a scaled `sample.draw` in the existing WebCodecs `process` callback, plus a `zoompan` stage on the ffmpeg path and a CSS `transform` in the preview.
- The lead-in is a settings value that `resolveShotTrimSettings` uses for the first shot with a take.

**Tech Stack:** React 18 + TypeScript 5.6, Vitest 2 + Testing Library (jsdom), Canvas 2D, Mediabunny (WebCodecs), ffmpeg.wasm.

**Spec:** `docs/superpowers/specs/2026-10-08-hook-first-shot-design.md`
**Prerequisite:** PR 1 (`docs/superpowers/plans/2026-10-08-hook-first-shot-pr1-style.md`) merged. Start a fresh branch `feat/hook-headline-punchin` from the updated `origin/main` in a worktree.

## Global Constraints

- **Headline**
  - Style: `HEADLINE_STYLE = { weight: 'bold', maxPx: 72, minPx: 56, maxLines: 2, lineHeight: 1.2 }`, white text with `*emphasis*`, band opacity `0.8`, band shrink-wrapped to the widest line plus `SUBTITLE_BOX_PADDING_X * 2`.
  - Shown over `[0, D)`. Its bottom sits `HEADLINE_GAP = SUBTITLE_BLOCK_GAP * 2` (28 px) above the topmost first-shot cue box. With no such box, it is centered at `hookPosition`. Clamped to `y ≥ 0`.
  - The text is per video (`SubtitleState.hookHeadline`, saved in `SavedSubtitles.hookHeadline?`), and on/off is a setting. It is shown even when the first shot's cues have no `ja`.
- **Punch-in:** scale `1 + 0.08 · t/D` for `t < D`, else `1` (`PUNCH_IN_ZOOM = 0.08`), about the frame center. Subtitles and the headline are never scaled.
- **Lead-in:** `firstShotPaddingStart` default `0.05`. A shot's own `trimPaddingStart` wins. "First shot" = the first script shot with a stored take.
- **New settings defaults:** `hookHeadlineEnabled: true`, `punchInEnabled: true`, `firstShotPaddingStart: 0.05`.
- **ffmpeg punch-in:** `zoompan` driven by `in/30` (the joined video is 30 fps). Its whole-pixel judder is accepted.
- Type-check with `npx tsc -b`. Work in a worktree, never switch the main checkout's branch.

---

### Task 0: Worktree setup

**Files:** none

- [ ] **Step 1: Create the worktree and install**

```bash
git fetch origin
git worktree add -b feat/hook-headline-punchin .claude/worktrees/hook-headline-punchin origin/main
cd .claude/worktrees/hook-headline-punchin && npm ci
```

- [ ] **Step 2: Baseline**

Run: `npx vitest run && npx tsc -b`
Expected: all pass (PR 1 is in `main`).

---

### Task 1: Hook model, settings and placement helpers

**Files:**
- Modify: `src/hooks/useSettings.ts`
- Modify: `src/hooks/useSettings.test.ts`
- Modify: `src/utils/subtitlePosition.ts`
- Modify: `src/utils/subtitlePosition.test.ts`
- Modify: `src/utils/subtitleHook.ts`
- Modify: `src/utils/subtitleHook.test.ts`
- Modify: `src/utils/burnSubtitles.ts` (use `clampedSubtitleY`)
- Modify: `src/pages/FinalizePage.tsx` (pass the widened `HookSettings`)
- Modify (fixtures only, for the widened `HookOptions`/`HookSettings`):
  - `src/utils/shotEncoding.test.ts`
  - `src/utils/burnSubtitles.test.ts`
  - `src/components/SubtitleOverlayPreview.test.tsx`
  - `src/components/SubtitleWorkflow.test.tsx`

**Interfaces:**
- Produces:
  - `AppSettings.hookHeadlineEnabled: boolean`, `AppSettings.punchInEnabled: boolean`, `AppSettings.firstShotPaddingStart: number`
  - `clampedSubtitleY(position: SubtitlePosition, overlayHeight: number, videoHeight = SUBTITLE_VIDEO_HEIGHT): number` (PR 1 already added `SUBTITLE_VIDEO_HEIGHT` and `clampedSubtitlePosition` to `subtitlePosition.ts`)
  - `HookOptions { style; position; headline: string; punchIn: boolean }`
  - `HookSettings = Pick<AppSettings, 'hookStyleEnabled' | 'hookPosition' | 'hookHeadlineEnabled' | 'punchInEnabled'>`
  - `hookOptionsOf(settings: HookSettings, headline = ''): HookOptions`
  - `startsInFirstShot(start: number, firstShotDuration: number): boolean`
  - `PUNCH_IN_ZOOM = 0.08`
  - `punchInScale(t: number, duration: number): number`
  - `punchInUntil(hook: HookOptions, firstShotDuration: number | null): number | null`
  - `hasFirstShotExtras(hook: HookOptions, firstShotDuration: number | null): boolean`
  - `HEADLINE_GAP` (28)
  - `headlineY(boxTops: number[], headlineHeight: number, hookPosition: SubtitlePosition): number`

- [ ] **Step 1: Write the failing tests**

`src/hooks/useSettings.test.ts`:
- Add `hookHeadlineEnabled: true, punchInEnabled: true, firstShotPaddingStart: 0.05` to `DEFAULTS`.
- Append inside `describe('useSettings', …)`:

```ts
  it('gives older stored settings the headline, punch-in and first-shot lead-in defaults', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false }))
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toMatchObject({
      hookHeadlineEnabled: true,
      punchInEnabled: true,
      firstShotPaddingStart: 0.05,
    })
  })
```

`src/utils/subtitlePosition.test.ts`: add `clampedSubtitleY` to the import, and append:

```ts
describe('clampedSubtitleY', () => {
  it('is subtitleY on the 1920px video while the box fits', () => {
    expect(clampedSubtitleY(50, 220)).toBe(850)
  })

  it('keeps the whole box on screen', () => {
    expect(clampedSubtitleY(0, 220)).toBeCloseTo(0, 5)
    expect(clampedSubtitleY(100, 220)).toBeCloseTo(1700, 5)
  })
})
```

`src/utils/subtitleHook.test.ts`: replace the `hookOptionsOf` describe and the import, and append the rest:

```ts
import {
  HEADLINE_GAP,
  hasFirstShotExtras,
  headlineY,
  hookOptionsOf,
  punchInScale,
  punchInUntil,
  startsInFirstShot,
  styleCues,
  type HookOptions,
} from './subtitleHook'
import { clampedSubtitleY } from './subtitlePosition'
```

```ts
describe('hookOptionsOf', () => {
  const settings = { hookStyleEnabled: false, hookPosition: 40, hookHeadlineEnabled: true, punchInEnabled: true }

  it('reads the hook settings, with the headline trimmed', () => {
    expect(hookOptionsOf(settings, '  Wait  ')).toEqual({ style: false, position: 40, headline: 'Wait', punchIn: true })
  })

  it('has no headline when it is switched off or not given', () => {
    expect(hookOptionsOf({ ...settings, hookHeadlineEnabled: false }, 'Wait').headline).toBe('')
    expect(hookOptionsOf(settings).headline).toBe('')
  })
})

describe('startsInFirstShot', () => {
  it('excludes a cue starting where the second shot does', () => {
    expect(startsInFirstShot(1.99, 2)).toBe(true)
    expect(startsInFirstShot(2, 2)).toBe(false)
  })
})

describe('punchInScale', () => {
  it('zooms from 1x to 1.08x over the first shot, then stops', () => {
    expect(punchInScale(0, 2)).toBe(1)
    expect(punchInScale(1, 2)).toBeCloseTo(1.04)
    expect(punchInScale(1.999, 2)).toBeCloseTo(1.08, 3)
    expect(punchInScale(2, 2)).toBe(1)
    expect(punchInScale(5, 2)).toBe(1)
  })

  it('does nothing for a shot without length', () => {
    expect(punchInScale(0.5, 0)).toBe(1)
  })
})

describe('first-shot extras', () => {
  const hook: HookOptions = { style: true, position: 50, headline: '', punchIn: false }

  it('only apply to a video starting with the first shot', () => {
    expect(hasFirstShotExtras({ ...hook, headline: 'Hi' }, 2)).toBe(true)
    expect(hasFirstShotExtras({ ...hook, punchIn: true }, 2)).toBe(true)
    expect(hasFirstShotExtras(hook, 2)).toBe(false)
    expect(hasFirstShotExtras({ ...hook, headline: 'Hi', punchIn: true }, null)).toBe(false)
  })

  it('zoom until the end of the first shot when the punch-in is on', () => {
    expect(punchInUntil({ ...hook, punchIn: true }, 2)).toBe(2)
    expect(punchInUntil(hook, 2)).toBeNull()
    expect(punchInUntil({ ...hook, punchIn: true }, null)).toBeNull()
  })
})

describe('headlineY', () => {
  it('sits the headline just above the topmost first-shot box', () => {
    expect(headlineY([900, 800], 100, 50)).toBe(800 - HEADLINE_GAP - 100)
  })

  it('centers it at the hook position with no box under it', () => {
    expect(headlineY([], 100, 50)).toBe(clampedSubtitleY(50, 100))
  })

  it('keeps it on screen', () => {
    expect(headlineY([50], 100, 50)).toBe(0)
  })
})
```

Fixture updates (these are type fixes; run them with the tests above):
- `src/utils/shotEncoding.test.ts`:

```ts
const NO_HOOK: HookOptions = { style: false, position: 50, headline: '', punchIn: false }
const HOOK: HookOptions = { style: true, position: 50, headline: '', punchIn: false }
```

  and in the `burnRequest` "cue style" test, change both inline hooks to `{ ...HOOK, position: 50 }` and `{ ...HOOK, position: 30 }`.
- `src/utils/burnSubtitles.test.ts`: `const LOOK: SubtitleLook = { position: 72, hook: { style: true, position: 50, headline: '', punchIn: false }, firstShotDuration: 2 }`.
- `src/components/SubtitleOverlayPreview.test.tsx`: `const HOOK = { style: true, position: 50, headline: '', punchIn: false }`.
- `src/components/SubtitleWorkflow.test.tsx`:
  - `const DEFAULT_HOOK_SETTINGS: HookSettings = { hookStyleEnabled: true, hookPosition: 50, hookHeadlineEnabled: true, punchInEnabled: true }`.
  - In the test `burns with the hook settings and the first shot's length`, the expected hook becomes `{ style: true, position: 50, headline: '', punchIn: true }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useSettings.test.ts src/utils/subtitlePosition.test.ts src/utils/subtitleHook.test.ts`
Expected: FAIL (missing exports and defaults).

- [ ] **Step 3: Implement**

`src/hooks/useSettings.ts`, add to `AppSettings`:

```ts
  /** Show the per-video hook headline above the first shot's subtitle. */
  hookHeadlineEnabled: boolean
  /** Slowly zoom the first shot's picture in. */
  punchInEnabled: boolean
  /** Seconds of silence auto-trim keeps before the first shot's speech. */
  firstShotPaddingStart: number
```

  and to `DEFAULTS`:

```ts
  hookHeadlineEnabled: true,
  punchInEnabled: true,
  firstShotPaddingStart: 0.05,
```

`src/utils/subtitlePosition.ts`, append (after PR 1's `clampedSubtitlePosition`):

```ts
/** Top of an overlay on the output video, kept so all of it stays on screen. */
export function clampedSubtitleY(
  position: SubtitlePosition,
  overlayHeight: number,
  videoHeight = SUBTITLE_VIDEO_HEIGHT,
): number {
  return subtitleY(clampedSubtitlePosition(position, overlayHeight, videoHeight), videoHeight, overlayHeight)
}
```

`src/utils/subtitleHook.ts`:
- Change the imports to:

```ts
import type { AppSettings } from '../hooks/useSettings'
import type { SubtitleCue } from './subtitleCues'
import { SUBTITLE_BLOCK_GAP, type CueVariant } from './subtitleLayout'
import { clampedSubtitleY, type SubtitlePosition } from './subtitlePosition'
```

- Replace `HookOptions`, `HookSettings`, `hookOptionsOf`, `EPSILON` and the `isHook` helper inside `styleCues`:

```ts
export interface HookOptions {
  /** Hook style for the first shot's cues, the first one from 0 s. */
  style: boolean
  /** 0-100, where hook cues are centered. */
  position: SubtitlePosition
  /** Shown above the hook subtitle during the first shot; '' = none. */
  headline: string
  /** Zoom the first shot's picture in (see punchInScale). */
  punchIn: boolean
}

export type HookSettings = Pick<
  AppSettings,
  'hookStyleEnabled' | 'hookPosition' | 'hookHeadlineEnabled' | 'punchInEnabled'
>

/** The hook as burned: settings plus this video's headline text. */
export function hookOptionsOf(settings: HookSettings, headline = ''): HookOptions {
  return {
    style: settings.hookStyleEnabled,
    position: settings.hookPosition,
    headline: settings.hookHeadlineEnabled ? headline.trim() : '',
    punchIn: settings.punchInEnabled,
  }
}

// A cue starting where the second shot does is not in the first one.
const EPSILON = 1e-6

export function startsInFirstShot(start: number, firstShotDuration: number): boolean {
  return start < firstShotDuration - EPSILON
}
```

  and inside `styleCues`:

```ts
  const isHook = (c: SubtitleCue) =>
    hookStyle && firstShotDuration !== null && startsInFirstShot(c.start, firstShotDuration)
```

- Append:

```ts
export const PUNCH_IN_ZOOM = 0.08

/**
 * How far the first shot's picture is zoomed at `t` seconds into it: a slow
 * push from 1x to 1 + PUNCH_IN_ZOOM over its `duration`, and 1x after it.
 */
export function punchInScale(t: number, duration: number): number {
  if (!(duration > 0) || t >= duration) return 1
  return 1 + (PUNCH_IN_ZOOM * Math.max(t, 0)) / duration
}

/**
 * Until when a video is zoomed in, or null: only a video starting with the
 * first shot (`firstShotDuration` set) gets the punch-in.
 */
export function punchInUntil(hook: HookOptions, firstShotDuration: number | null): number | null {
  return hook.punchIn ? firstShotDuration : null
}

/** Whether a video starting with the first shot needs an encode even without subtitles. */
export function hasFirstShotExtras(hook: HookOptions, firstShotDuration: number | null): boolean {
  return firstShotDuration !== null && (hook.headline !== '' || hook.punchIn)
}

/** Space between the headline and the subtitle box under it, in output px. */
export const HEADLINE_GAP = SUBTITLE_BLOCK_GAP * 2

/**
 * Top of the headline: just above the topmost of the first shot's subtitle
 * boxes (`boxTops`), so it stays put while they change, or centered at the
 * hook position when there is none. Never above the frame.
 */
export function headlineY(boxTops: number[], headlineHeight: number, hookPosition: SubtitlePosition): number {
  const y = boxTops.length > 0
    ? Math.min(...boxTops) - HEADLINE_GAP - headlineHeight
    : clampedSubtitleY(hookPosition, headlineHeight)
  return Math.max(0, y)
}
```

`src/pages/FinalizePage.tsx` (otherwise it stops type-checking against the widened `HookSettings`):
- Change `const { hookStyleEnabled, hookPosition } = settings` to `const { hookStyleEnabled, hookPosition, hookHeadlineEnabled, punchInEnabled } = settings`.
- Change the memoized hook (PR 1 builds it once with `useMemo`, used by the background-burn effect and the `burn` prop) to:

```ts
  const hook = useMemo(
    () => hookOptionsOf({ hookStyleEnabled, hookPosition, hookHeadlineEnabled, punchInEnabled }),
    [hookStyleEnabled, hookPosition, hookHeadlineEnabled, punchInEnabled],
  )
```

- Change the prop to `hookSettings={{ hookStyleEnabled, hookPosition, hookHeadlineEnabled, punchInEnabled }}`.

(Task 7 adds the headline text to these same places.)

`src/utils/burnSubtitles.ts`:
- Import `clampedSubtitleY` from `./subtitlePosition`. Drop the `subtitleY`, `clampedSubtitlePosition` and `SUBTITLE_VIDEO_HEIGHT` imports if they are no longer used.
- In `renderSubtitleOverlays`, set `y: clampedSubtitleY(cuePosition(cue, look), height),` (same value as PR 1's `subtitleY(clampedSubtitlePosition(…), SUBTITLE_VIDEO_HEIGHT, height)`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks src/utils src/components src/pages && npx tsc -b`
Expected: PASS, and tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: add headline, punch-in and first-shot lead-in settings to the hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: First-shot lead-in

**Files:**
- Modify: `src/utils/shotTrim.ts`
- Modify: `src/utils/shotTrim.test.ts`
- Modify: `src/pages/FinalizePage.tsx` (load)
- Modify: `src/pages/FinalizePage.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `AppSettings.firstShotPaddingStart` (Task 1).
- Produces: `resolveShotTrimSettings(shot: Shot | undefined, global: AppSettings, isFirstShot = false): ShotTrimSettings`.

- [ ] **Step 1: Write the failing tests**

`src/utils/shotTrim.test.ts`:
- Change the imports to:

```ts
import { clampTrimRange, resolveShotTrimSettings } from './shotTrim'
import type { AppSettings } from '../hooks/useSettings'
```

- Append:

```ts
describe('resolveShotTrimSettings', () => {
  const GLOBAL: AppSettings = {
    trimEnabled: true,
    trimPaddingStart: 0.3,
    trimPaddingEnd: 0.4,
    normalizeAudio: true,
    defaultBgmId: null,
    bgmVolume: 0.3,
    subtitlePosition: 72,
    hookStyleEnabled: true,
    hookPosition: 50,
    hookHeadlineEnabled: true,
    punchInEnabled: true,
    firstShotPaddingStart: 0.05,
  }

  it('gives the first shot its own lead-in before the speech', () => {
    expect(resolveShotTrimSettings({ id: 'a', text: '' }, GLOBAL, true)).toEqual({
      trimEnabled: true,
      trimPaddingStart: 0.05,
      trimPaddingEnd: 0.4,
    })
  })

  it('keeps the usual lead-in for the other shots', () => {
    expect(resolveShotTrimSettings({ id: 'b', text: '' }, GLOBAL).trimPaddingStart).toBe(0.3)
  })

  it('lets a shot\'s own lead-in win, first shot or not', () => {
    expect(resolveShotTrimSettings({ id: 'a', text: '', trimPaddingStart: 0.6 }, GLOBAL, true).trimPaddingStart).toBe(0.6)
  })
})
```

`src/pages/FinalizePage.test.tsx`:
- In `beforeEach`, keep the old tests' expectations by pinning the first shot to the usual lead-in:

```ts
  // The tests below predate the usual BGM; they walk the BGM step by hand.
  // They also predate the first shot's own lead-in, so it is the usual 0.3s.
  localStorage.setItem('teleprompter_settings', JSON.stringify({ defaultBgmId: null, firstShotPaddingStart: 0.3 }))
```

- Append to `describe('FinalizePage trim step: auto-cut around the speech (issue #21)')`:

```ts
  it('opens the first shot with its own, shorter lead-in', async () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ defaultBgmId: null, firstShotPaddingStart: 0.1 }))
    vi.mocked(probeVideoDuration).mockResolvedValueOnce(5)
    vi.mocked(detectSpeech).mockResolvedValueOnce(SPEECH_1_TO_3)
    renderFinalizePage('script-1')

    // 1.0s - 0.1s, rather than the usual 0.3s before.
    await screen.findByText('開始 0.9秒')
    expect(screen.getByText('終了 3.4秒')).toBeInTheDocument()
  })
```

`src/pages/SettingsPage.test.tsx`, append:

```ts
describe('SettingsPage auto-trim', () => {
  it('saves the first shot\'s lead-in', () => {
    renderSettings()
    expect(screen.getByText('0.05秒')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider', { name: '最初のショットの前に残す時間' }), { target: { value: '0.2' } })
    expect(stored().firstShotPaddingStart).toBe(0.2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/shotTrim.test.ts src/pages/FinalizePage.test.tsx src/pages/SettingsPage.test.tsx`
Expected: FAIL. The first shot still uses 0.3, and the slider is missing.

- [ ] **Step 3: Implement**

`src/utils/shotTrim.ts`:

```ts
/**
 * A shot's own auto-trim override, falling back to the global settings.
 * The first shot opens the video, where viewers decide within a second
 * whether to stay, so it has a lead-in of its own (almost none).
 */
export function resolveShotTrimSettings(
  shot: Shot | undefined,
  global: AppSettings,
  isFirstShot = false,
): ShotTrimSettings {
  return {
    trimEnabled: shot?.trimEnabled ?? global.trimEnabled,
    trimPaddingStart: shot?.trimPaddingStart ?? (isFirstShot ? global.firstShotPaddingStart : global.trimPaddingStart),
    trimPaddingEnd: shot?.trimPaddingEnd ?? global.trimPaddingEnd,
  }
}
```

`src/pages/FinalizePage.tsx`: in the load `.then`, replace the `trimSettings` line:

```ts
      // The first shot with a take opens the video, and gets its own lead-in.
      const firstShotId = script.shots.find(shot => byShotId.has(shot.id))?.id
      const trimSettings = new Map(
        script.shots.map(shot => [shot.id, resolveShotTrimSettings(shot, settings, shot.id === firstShotId)]),
      )
```

`src/pages/SettingsPage.tsx`: insert after the 「前に残す時間」 row (before 「後ろに残す時間」):

```tsx
        <div className={`${styles.row} ${styles.sliderRow} ${!settings.trimEnabled ? styles.disabled : ''}`}>
          <div className={styles.sliderHeader}>
            <div>
              <div className={styles.rowLabel}>最初のショットの前に残す時間</div>
              <div className={styles.rowSub}>動画の冒頭は話し始めの直前から始めます</div>
            </div>
            <span className={styles.sliderValue}>{settings.firstShotPaddingStart.toFixed(2)}秒</span>
          </div>
          <input
            type="range"
            aria-label="最初のショットの前に残す時間"
            className={styles.slider}
            min={0}
            max={0.5}
            step={0.05}
            value={settings.firstShotPaddingStart}
            onChange={e => updateSettings({ firstShotPaddingStart: parseFloat(e.target.value) })}
            disabled={!settings.trimEnabled}
          />
        </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/shotTrim.test.ts src/pages/FinalizePage.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/shotTrim.ts src/utils/shotTrim.test.ts src/pages/FinalizePage.tsx src/pages/FinalizePage.test.tsx src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat: open the first shot right before its first word

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Headline layout

**Files:**
- Modify: `src/utils/subtitleLayout.ts`
- Modify: `src/utils/subtitleLayout.test.ts`

**Interfaces:**
- Produces:
  - `HEADLINE_STYLE: TextStyle`
  - `HEADLINE_BOX_OPACITY = 0.8`
  - `interface HeadlineLayout { block: TextBlockLayout; width: number; height: number }`
  - `layoutHeadline(text: string, measure: MeasureText): HeadlineLayout`

- [ ] **Step 1: Write the failing tests**

In `src/utils/subtitleLayout.test.ts`, add `HEADLINE_STYLE` and `layoutHeadline` to the import, then append:

```ts
describe('layoutHeadline', () => {
  it('shrink-wraps its band around a short headline', () => {
    const layout = layoutHeadline('Wait.', measure)
    expect(HEADLINE_STYLE).toMatchObject({ weight: 'bold', maxPx: 72, minPx: 56, maxLines: 2 })
    expect(layout.block).toMatchObject({ fontPx: 72, lines: ['Wait.'] })
    // 5 chars at 36px each, plus 40px padding either side.
    expect(layout.width).toBe(5 * 36 + 80)
    expect(layout.height).toBe(28 * 2 + Math.round(72 * 1.2))
  })

  it('wraps a longer headline onto two lines, never wider than a subtitle band', () => {
    const layout = layoutHeadline("'carry a torch' ≠ romantic? Not quite", measure)
    expect(layout.block.lines.length).toBe(2)
    expect(layout.width).toBeLessThanOrEqual(1080 - 90 * 2)
  })

  it('keeps emphasized words', () => {
    expect(layoutHeadline('Wait *what*', measure).block.runs).toEqual([[
      { text: 'Wait ', emphasized: false },
      { text: 'what', emphasized: true },
    ]])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/subtitleLayout.test.ts`
Expected: FAIL (`layoutHeadline` is not a function).

- [ ] **Step 3: Implement**

In `src/utils/subtitleLayout.ts`, append after `layoutCue`:

```ts
/**
 * The first shot's headline: short on-screen-only text above the hook
 * subtitle. Bold white on a dark band as wide as its text, so it reads as
 * a title rather than one more subtitle.
 */
export const HEADLINE_STYLE: TextStyle = { weight: 'bold', maxPx: 72, minPx: 56, maxLines: 2, lineHeight: 1.2 }
export const HEADLINE_BOX_OPACITY = 0.8

export interface HeadlineLayout {
  block: TextBlockLayout
  /** Width of its band: the widest line plus padding, at most a subtitle band's. */
  width: number
  height: number
}

export function layoutHeadline(text: string, measure: MeasureText): HeadlineLayout {
  const block = layoutBlock(text, HEADLINE_STYLE, measure)
  const font = fontFor(HEADLINE_STYLE, block.fontPx)
  const widest = Math.max(0, ...block.lines.map(line => measure(line, font)))
  return {
    block,
    width: Math.min(widest + SUBTITLE_BOX_PADDING_X * 2, SUBTITLE_REFERENCE_WIDTH - SUBTITLE_BOX_MARGIN_X * 2),
    height: SUBTITLE_BOX_PADDING_Y * 2 + block.lines.length * block.lineHeightPx,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/subtitleLayout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/subtitleLayout.ts src/utils/subtitleLayout.test.ts
git commit -m "feat: lay out the hook headline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Punch-in on the WebCodecs paths

**Files:**
- Create: `src/utils/webcodecs/subtitleOverlay.test.ts`
- Modify: `src/utils/webcodecs/subtitleOverlay.ts`
- Modify: `src/utils/webcodecs/normalizeShot.ts`
- Modify: `src/utils/webcodecs/burnSubtitlesWebCodecs.ts`

**Interfaces:**
- Consumes: `punchInScale` (Task 1).
- Produces:
  - `interface OverlayOptions { punchInUntil?: number | null }`
  - `createOverlayProcess(overlays, options?: OverlayOptions)`
  - `normalizeShotWebCodecs(blob, start, end, onProgress?, overlays = [], signal?, options: OverlayOptions = {})`
  - `burnSubtitlesWebCodecs(videoBlob, overlays, onProgress?, signal?, options: OverlayOptions = {})`

- [ ] **Step 1: Write the failing test**

Create `src/utils/webcodecs/subtitleOverlay.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VideoSample } from 'mediabunny'
import { createOverlayProcess } from './subtitleOverlay'

// jsdom has no OffscreenCanvas; the process only needs one to draw into.
class FakeCanvas {
  width: number
  height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
  getContext() {
    return { drawImage: vi.fn() }
  }
}

/** A 1080x1920 frame whose midpoint is at `t` seconds. */
function frameAt(t: number) {
  const draw = vi.fn()
  const duration = 1 / 30
  const sample = { timestamp: t - duration / 2, duration, displayWidth: 1080, displayHeight: 1920, draw }
  return { sample: sample as unknown as VideoSample, draw }
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createOverlayProcess punch-in', () => {
  it('draws the first shot\'s picture zoomed about its center', async () => {
    const { process } = await createOverlayProcess([], { punchInUntil: 2 })
    const { sample, draw } = frameAt(1)

    expect(process(sample)).toBeInstanceOf(FakeCanvas)
    const [, x, y, w, h] = draw.mock.calls[0]
    expect(w).toBeCloseTo(1080 * 1.04)
    expect(h).toBeCloseTo(1920 * 1.04)
    expect(x).toBeCloseTo((1080 - 1080 * 1.04) / 2)
    expect(y).toBeCloseTo((1920 - 1920 * 1.04) / 2)
  })

  it('passes frames after the first shot through untouched', async () => {
    const { process } = await createOverlayProcess([], { punchInUntil: 2 })
    const { sample, draw } = frameAt(2.5)
    expect(process(sample)).toBe(sample)
    expect(draw).not.toHaveBeenCalled()
  })

  it('leaves the picture alone without a punch-in', async () => {
    const { process } = await createOverlayProcess([])
    const { sample } = frameAt(0.5)
    expect(process(sample)).toBe(sample)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/webcodecs/subtitleOverlay.test.ts`
Expected: FAIL. The first test gets the sample back, because there is no zoom yet.

- [ ] **Step 3: Implement**

Replace `src/utils/webcodecs/subtitleOverlay.ts` with:

```ts
import type { VideoSample } from 'mediabunny'
import { punchInScale } from '../subtitleHook'

export interface SubtitleOverlay {
  start: number
  end: number
  image: Blob
  /** Top edge of the image in the output frame. */
  y: number
}

export interface OverlayOptions {
  /** Zoom the picture in over [0, punchInUntil) (see punchInScale); null = never. */
  punchInUntil?: number | null
}

export interface OverlayProcess {
  /** Mediabunny `video.process`: zooms the frame and composites the active cues onto it. */
  process: (sample: VideoSample) => VideoSample | OffscreenCanvas
  dispose: () => void
}

/**
 * Build a Mediabunny `video.process` callback that composites each cue's
 * pre-rendered PNG at (centered, its y) during [start, end), in the frame's
 * own timeline, over the picture zoomed in by the first shot's punch-in.
 * Only the picture is zoomed, the subtitles keep their size. Frames with no
 * active cue and no zoom are passed through untouched. Mediabunny calls this
 * after resizing to the output size. Call `dispose` once the conversion ends
 * to release the decoded images.
 */
export async function createOverlayProcess(
  overlays: SubtitleOverlay[],
  { punchInUntil = null }: OverlayOptions = {},
): Promise<OverlayProcess> {
  const bitmaps = await Promise.all(overlays.map(o => createImageBitmap(o.image)))
  const cues = overlays.map((o, i) => ({ start: o.start, end: o.end, y: o.y, bitmap: bitmaps[i] }))
  let canvas: OffscreenCanvas | null = null
  let ctx: OffscreenCanvasRenderingContext2D | null = null

  return {
    process: (sample: VideoSample) => {
      // Midpoint of the frame, so a cue boundary that falls exactly on a
      // frame edge doesn't flicker on for a single extra frame.
      const t = sample.timestamp + sample.duration / 2
      const active = cues.filter(c => t >= c.start && t < c.end)
      const scale = punchInUntil !== null ? punchInScale(t, punchInUntil) : 1
      if (active.length === 0 && scale === 1) return sample
      const width = sample.displayWidth
      const height = sample.displayHeight
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        canvas = new OffscreenCanvas(width, height)
        ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
      }
      const w = width * scale
      const h = height * scale
      sample.draw(ctx!, (width - w) / 2, (height - h) / 2, w, h)
      for (const cue of active) {
        ctx!.drawImage(cue.bitmap, Math.round((width - cue.bitmap.width) / 2), cue.y)
      }
      return canvas
    },
    dispose: () => bitmaps.forEach(b => b.close()),
  }
}
```

`src/utils/webcodecs/normalizeShot.ts`:
- Change the import to `import { createOverlayProcess, type OverlayOptions, type SubtitleOverlay } from './subtitleOverlay'`.
- Add the parameter after `signal?: AbortSignal,`:

```ts
  options: OverlayOptions = {},
```

- Replace the `overlay` line:

```ts
  const punchInUntil = options.punchInUntil ?? null
  const overlay = overlays.length > 0 || punchInUntil !== null
    ? await createOverlayProcess(overlays, { punchInUntil })
    : null
```

- Append to the doc comment: "`options.punchInUntil` zooms the first shot's picture in during the same encode."

`src/utils/webcodecs/burnSubtitlesWebCodecs.ts`:
- Change the import to `import { createOverlayProcess, type OverlayOptions, type SubtitleOverlay } from './subtitleOverlay'`.
- Add `options: OverlayOptions = {},` after `signal?: AbortSignal,`.
- Change the overlay line to `const overlay = await createOverlayProcess(overlays, options)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/webcodecs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/webcodecs/subtitleOverlay.ts src/utils/webcodecs/subtitleOverlay.test.ts src/utils/webcodecs/normalizeShot.ts src/utils/webcodecs/burnSubtitlesWebCodecs.ts
git commit -m "feat: punch in on the first shot's picture in the hardware encode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Headline overlay, punch-in plumbing and ffmpeg zoompan in the burn paths

**Files:**
- Modify: `src/utils/burnSubtitles.ts`
- Modify: `src/utils/burnSubtitles.test.ts`
- Modify: `src/utils/shotEncoding.ts`
- Modify: `src/utils/shotEncoding.test.ts`

**Interfaces:**
- Consumes:
  - From Task 1: `headlineY`, `punchInUntil`, `hasFirstShotExtras`, `startsInFirstShot`, `PUNCH_IN_ZOOM`
  - From Task 3: `layoutHeadline`, `HEADLINE_STYLE`, `HEADLINE_BOX_OPACITY`
  - From Task 4: `OverlayOptions`
- Produces:
  - `renderHeadlineImage(text: string): Promise<{ image: Blob; height: number }>`
  - `punchInFilter(until: number): string`
  - `buildOverlayFilterGraph(ys: number[], baseFilter?: string)`
  - `renderSubtitleOverlays` adds the headline overlay
  - `burnSubtitles`/`burnShotSubtitles` pass the punch-in
  - `burnRequest`/`burnSubtitlesByShot` treat a headline or punch-in as work

- [ ] **Step 1: Write the failing tests**

`src/utils/burnSubtitles.test.ts`:
1. Replace the `./webcodecs/support` mock so the real `OUTPUT_*` constants stay available:

```ts
vi.mock('./webcodecs/support', async importOriginal => ({
  ...(await importOriginal<typeof import('./webcodecs/support')>()),
  canUseWebCodecs: vi.fn(async () => true),
  disableWebCodecs: vi.fn(),
}))
```

2. Extend the imports:

```ts
import {
  buildOverlayFilterGraph,
  burnSubtitles,
  cuePosition,
  ffmpegProgressRatio,
  punchInFilter,
  renderCueImage,
  renderSubtitleOverlays,
  type SubtitleLook,
} from './burnSubtitles'
import { layoutCue, layoutHeadline, type MeasureText } from './subtitleLayout'
import { clampedSubtitleY, subtitleY } from './subtitlePosition'
import { headlineY, type StyledCue } from './subtitleHook'
```

3. Append:

```ts
describe('buildOverlayFilterGraph with a punch-in', () => {
  it('feeds the overlays from the zoomed base video', () => {
    expect(buildOverlayFilterGraph([100], 'zoompan=Z')).toEqual({
      filterGraph: '[0:v]zoompan=Z[base];[base][sub0]overlay=x=(W-w)/2:y=100[v0]',
      outputLabel: '[v0]',
    })
  })

  it('outputs the zoomed video when there is nothing to overlay', () => {
    expect(buildOverlayFilterGraph([], 'zoompan=Z')).toEqual({ filterGraph: '[0:v]zoompan=Z[base]', outputLabel: '[base]' })
  })
})

describe('punchInFilter', () => {
  it('zooms the first seconds in about the center, at the output size and rate', () => {
    expect(punchInFilter(2)).toBe(
      "zoompan=z='if(lt(in/30,2.000),1+0.08*in/30/2.000,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30",
    )
  })
})

describe('the hook headline', () => {
  const headlineLook = (headline: string, firstShotDuration: number | null = 2): SubtitleLook => ({
    position: 72,
    hook: { style: true, position: 50, headline, punchIn: false },
    firstShotDuration,
  })
  const hookCue: StyledCue = { id: 'a', start: 0, end: 1, en: 'Hi', ja: 'やあ', variant: 'hook' }
  const laterCue: StyledCue = { id: 'b', start: 2.5, end: 3, en: 'Bye', ja: 'じゃあ', variant: 'normal' }

  it('shows over the first shot, just above its subtitle, emphasis in yellow', async () => {
    const { drawn } = stubCanvas()
    const overlays = await renderSubtitleOverlays([hookCue, laterCue], headlineLook('Wait *what*'))
    const cueTop = clampedSubtitleY(50, layoutCue(hookCue, measure, 'hook').height)
    const headline = layoutHeadline('Wait *what*', measure)
    expect(overlays).toHaveLength(3)
    expect(overlays[2]).toMatchObject({ start: 0, end: 2, y: headlineY([cueTop], headline.height, 50) })
    expect(drawn).toContainEqual(expect.objectContaining({ text: 'what', color: '#FFD60A' }))
  })

  it('centers at the hook position when the first shot has no subtitle', async () => {
    stubCanvas()
    const overlays = await renderSubtitleOverlays([laterCue], headlineLook('Wait'))
    const headline = layoutHeadline('Wait', measure)
    expect(overlays[1]).toMatchObject({ start: 0, end: 2, y: clampedSubtitleY(50, headline.height) })
  })

  it('is left out of any clip but the first shot\'s', async () => {
    stubCanvas()
    expect(await renderSubtitleOverlays([laterCue], headlineLook('Wait', null))).toHaveLength(1)
  })

  it('is burned even when no cue is translated', async () => {
    stubCanvas()
    await burnSubtitles(new Blob(['x']), [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: null }], headlineLook('Wait'))
    expect(vi.mocked(burnSubtitlesWebCodecs).mock.calls[0][1]).toHaveLength(1)
  })
})

describe('burnSubtitles punch-in', () => {
  it('zooms the whole video\'s first shot on the hardware path', async () => {
    stubCanvas()
    const look: SubtitleLook = { position: 72, hook: { style: true, position: 50, headline: '', punchIn: true }, firstShotDuration: 2 }
    await burnSubtitles(new Blob(['x']), [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: 'やあ' }], look)
    expect(vi.mocked(burnSubtitlesWebCodecs).mock.calls[0][4]).toEqual({ punchInUntil: 2 })
  })
})
```

`src/utils/shotEncoding.test.ts`, append:

```ts
describe('first-shot headline and punch-in', () => {
  const EXTRAS: HookOptions = { style: true, position: 50, headline: 'Wait', punchIn: true }
  const clips = [clip('a', 0, 2), clip('b', 0, 1)]
  const cues = translate(cuesFromShotEntries([
    { text: 'first', duration: 2 },
    { text: 'second', duration: 1 },
  ]))

  it('go into the first shot\'s encode only', async () => {
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, EXTRAS)
    const looks = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[4])
    expect(looks.map(l => l.firstShotDuration)).toEqual([2, null])
  })

  it('re-encode only the first shot when the headline changes', async () => {
    const cache = new ShotEncodeCache()
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, EXTRAS)
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, { ...EXTRAS, headline: 'Hold on' })
    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(3)
    expect(vi.mocked(burnModule.burnShotSubtitles).mock.calls[2][0]).toBe(clips[0].blob)
  })

  it('still burn the first shot when it has no translated cue', () => {
    const shot = clip('a', 0, 2)
    const first = look(50, { hook: { ...EXTRAS, punchIn: false }, firstShotDuration: 2 })
    expect(burnRequest(shot, [], first).key).not.toBe(normalizeRequest(shot).key)
    expect(burnRequest(shot, [], { ...first, firstShotDuration: null }).key).toBe(normalizeRequest(shot).key)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/burnSubtitles.test.ts src/utils/shotEncoding.test.ts`
Expected: FAIL. `punchInFilter` is not exported, there is no headline overlay, and the headline-only first shot is still a normalize request.

- [ ] **Step 3: Implement `burnSubtitles.ts`**

1. Imports. Add or extend:

```ts
import {
  hasFirstShotExtras,
  headlineY,
  PUNCH_IN_ZOOM,
  punchInUntil,
  startsInFirstShot,
  styleCues,
  type HookOptions,
  type StyledCue,
} from './subtitleHook'
import {
  HEADLINE_BOX_OPACITY,
  HEADLINE_STYLE,
  layoutHeadline,
  type MeasureText,
  // ...plus the names already imported from './subtitleLayout'
} from './subtitleLayout'
import { OUTPUT_FRAME_RATE, OUTPUT_HEIGHT, OUTPUT_WIDTH } from './webcodecs/support'
```

(`canUseWebCodecs` and `disableWebCodecs` are already imported from `./webcodecs/support`. Merge them into one import statement.)

2. Replace `buildOverlayFilterGraph`, keeping its doc comment and adding a sentence about `baseFilter`:

```ts
/**
 * Build the chained overlay filtergraph for one subtitle image input per
 * entry of `ys` (indices 1..ys.length, input 0 is the base video), each
 * composited horizontally centered at its own Y (cue boxes differ in height
 * with their line count). Each image input is itself time-bounded via
 * `-loop 1 -t <duration>` and an `-itsoffset <start>` at the ffmpeg-input
 * level (see burnSubtitles below), so no `enable=` time-window expression is
 * needed here — simpler and less error-prone than threading per-cue timing
 * through the filter string itself. `baseFilter` (the punch-in) is applied
 * to the video first, under the overlays.
 */
export function buildOverlayFilterGraph(ys: number[], baseFilter?: string): { filterGraph: string; outputLabel: string } {
  const base = baseFilter ? '[base]' : '[0:v]'
  const prelude = baseFilter ? [`[0:v]${baseFilter}[base]`] : []
  if (ys.length === 0) {
    return { filterGraph: prelude.join(';'), outputLabel: base }
  }

  const stages = ys.map((y, i) => {
    const baseInput = i === 0 ? base : `[v${i - 1}]`
    return `${baseInput}[sub${i}]overlay=x=(W-w)/2:y=${y}[v${i}]`
  })

  return { filterGraph: [...prelude, ...stages].join(';'), outputLabel: `[v${ys.length - 1}]` }
}

/**
 * ffmpeg's punch-in: zoom the joined video's first `until` seconds in from
 * 1x to 1 + PUNCH_IN_ZOOM about the center, as punchInScale does on the
 * hardware path. `in` counts input frames, and the joined video is
 * normalized to OUTPUT_FRAME_RATE. zoompan crops to whole pixels, so the
 * zoom may judder slightly — accepted on this last-resort path.
 */
export function punchInFilter(until: number): string {
  const t = `in/${OUTPUT_FRAME_RATE}`
  const d = until.toFixed(3)
  return `zoompan=z='if(lt(${t},${d}),1+${PUNCH_IN_ZOOM}*${t}/${d},1)'`
    + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:fps=${OUTPUT_FRAME_RATE}`
}
```

3. Factor the canvas plumbing out of `renderCueImage` (so the headline doesn't copy it). Add above `renderCueImage`:

```ts
/** Text measurement on a scratch canvas, matching what gets drawn. */
function canvasMeasure(): MeasureText {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  return (text, font) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
}

/** A video-wide transparent canvas `height` tall, set up for drawing runs. */
function overlayCanvas(height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = SUBTITLE_REFERENCE_WIDTH
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  // Runs are laid side by side from the left, centered as a whole line.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  return { canvas, ctx }
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to render subtitle image'))
    }, 'image/png')
  })
}
```

and rewrite `renderCueImage`'s body to use them (same drawing as before):

```ts
export async function renderCueImage(
  cue: SubtitleCue,
  variant: CueVariant = 'normal',
): Promise<{ image: Blob; height: number }> {
  const layout = layoutCue(cue, canvasMeasure(), variant)
  const width = SUBTITLE_REFERENCE_WIDTH
  const height = layout.height
  const { canvas, ctx } = overlayCanvas(height)

  ctx.fillStyle = `rgba(0, 0, 0, ${SUBTITLE_BOX_OPACITY[variant]})`
  ctx.beginPath()
  ctx.roundRect(SUBTITLE_BOX_MARGIN_X, 0, width - SUBTITLE_BOX_MARGIN_X * 2, height, SUBTITLE_BOX_RADIUS)
  ctx.fill()

  let top = SUBTITLE_BOX_PADDING_Y
  const drawBlock = (block: TextBlockLayout, font: string, color: string) => {
    ctx.font = font
    for (const runs of block.runs) {
      fillRuns(ctx, runs, width / 2, top + block.lineHeightPx / 2, color)
      top += block.lineHeightPx
    }
  }
  const styles = textStylesFor(variant)
  drawBlock(layout.en, fontFor(styles.en, layout.en.fontPx), '#ffffff')
  if (layout.ja) {
    top += SUBTITLE_BLOCK_GAP
    drawBlock(layout.ja, fontFor(styles.ja, layout.ja.fontPx), 'rgba(255, 255, 255, 0.85)')
  }
  return { image: await toPng(canvas), height }
}

/** Render the hook headline: bold white, emphasis in yellow, on a band as wide as its text. */
export async function renderHeadlineImage(text: string): Promise<{ image: Blob; height: number }> {
  const layout = layoutHeadline(text, canvasMeasure())
  const width = SUBTITLE_REFERENCE_WIDTH
  const { canvas, ctx } = overlayCanvas(layout.height)

  ctx.fillStyle = `rgba(0, 0, 0, ${HEADLINE_BOX_OPACITY})`
  ctx.beginPath()
  ctx.roundRect((width - layout.width) / 2, 0, layout.width, layout.height, SUBTITLE_BOX_RADIUS)
  ctx.fill()

  ctx.font = fontFor(HEADLINE_STYLE, layout.block.fontPx)
  let top = SUBTITLE_BOX_PADDING_Y
  for (const runs of layout.block.runs) {
    fillRuns(ctx, runs, width / 2, top + layout.block.lineHeightPx / 2, '#ffffff')
    top += layout.block.lineHeightPx
  }
  return { image: await toPng(canvas), height: layout.height }
}
```

4. In `renderSubtitleOverlays`, before `return overlays`, add:

```ts
  const firstShot = look.firstShotDuration
  if (firstShot !== null && look.hook.headline) {
    // Above the topmost of the first shot's subtitles, so it holds still
    // while they change underneath it.
    const boxTops = overlays.filter(o => startsInFirstShot(o.start, firstShot)).map(o => o.y)
    const { image, height } = await renderHeadlineImage(look.hook.headline)
    overlays.push({ start: 0, end: firstShot, image, y: headlineY(boxTops, height, look.hook.position) })
  }
```

  and extend its doc comment: "A video starting with the first shot also gets the hook headline over [0, D), even with no translated cue."

5. In `burnSubtitles`:
- Replace the early return.
- Pass the punch-in to both backends.
- Hand ffmpeg the overlays.

```ts
  const translated = styleCues(cues, look.firstShotDuration, look.hook.style).filter(c => c.ja !== null)
  if (translated.length === 0 && !hasFirstShotExtras(look.hook, look.firstShotDuration)) {
    // Nothing to burn in — return the video unchanged.
    return videoBlob
  }
  const overlays = await renderSubtitleOverlays(translated, look)
  const zoomUntil = punchInUntil(look.hook, look.firstShotDuration)

  if (await canUseWebCodecs()) {
    try {
      return await burnSubtitlesWebCodecs(videoBlob, overlays, onProgress, signal, { punchInUntil: zoomUntil })
    } catch (err) {
      // A cancel isn't WebCodecs breaking down: don't fall back or turn it off.
      throwIfCancelled(signal)
      disableWebCodecs(err)
      onProgress?.(0)
    }
  }
  return burnSubtitlesFFmpeg(videoBlob, overlays, zoomUntil, onProgress, signal)
```

6. In `burnShotSubtitles`, pass the punch-in:

```ts
  const overlays = await renderSubtitleOverlays(cues, look)
  return normalizeShotWebCodecs(blob, start, end, onProgress, overlays, signal, {
    punchInUntil: punchInUntil(look.hook, look.firstShotDuration),
  })
```

7. Rework `burnSubtitlesFFmpeg` to take overlays. The headline has no cue, so ffmpeg can't be fed cues any more.
- Signature:

```ts
async function burnSubtitlesFFmpeg(
  videoBlob: Blob,
  overlays: SubtitleOverlay[],
  zoomUntil: number | null,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
```

- The image-input loop (keep the `-itsoffset` comment above the `args.push`):

```ts
    for (let i = 0; i < overlays.length; i++) {
      const overlay = overlays[i]
      const name = `sub${i}.png`
      await ff.writeFile(name, await fetchFile(overlay.image))
      args.push('-loop', '1', '-itsoffset', overlay.start.toFixed(3), '-t', (overlay.end - overlay.start).toFixed(3), '-i', name)
    }

    const { filterGraph, outputLabel } = buildOverlayFilterGraph(
      overlays.map(o => o.y),
      zoomUntil !== null ? punchInFilter(zoomUntil) : undefined,
    )
```

- The filtergraph assembly (keep the long comment about the alias preamble and `eof_action=pass`):

```ts
    const aliasStages = overlays.map((_, i) => `[${i + 1}:v]copy[sub${i}]`)
    const overlayStages = filterGraph.replace(/overlay=/g, 'overlay=eof_action=pass:')
    const fullFilterGraph = [...aliasStages, overlayStages].filter(Boolean).join(';')
```

- The cleanup loop: `for (let i = 0; i < overlays.length; i++) ff.deleteFile(\`sub${i}.png\`)`.
- Update the doc comment: "feed each overlay's PNG in as a time-bounded image input and composite them via a chained overlay filtergraph, over the punch-in when there is one."
- Delete `cueDuration` only if nothing uses it any more. `renderSubtitleOverlays` still does, so keep it.

- [ ] **Step 4: Implement `shotEncoding.ts`**

Change the import to `import { hasFirstShotExtras, styleCues, type HookOptions, type StyledCue } from './subtitleHook'`. Then replace `burnRequest`:

```ts
/**
 * The shot trimmed and normalized with `cues` (styled, in the shot's own
 * timeline) burned in by the same encode, plus the headline and punch-in
 * when it's the first shot. A shot with nothing of that is just its
 * normalized clip, so it's shared with the combine step's cache entry. The
 * key holds everything that changes the pixels, so a hook change re-encodes
 * only the shots it shows up in.
 */
export function burnRequest(clip: ShotClip, cues: StyledCue[], look: SubtitleLook): EncodeRequest {
  const translated = cues.filter(c => c.ja !== null)
  const extras = hasFirstShotExtras(look.hook, look.firstShotDuration)
  if (translated.length === 0 && !extras) return normalizeRequest(clip)
  const hasNormalCue = translated.some(c => c.variant === 'normal')
  const hasHookCue = translated.some(c => c.variant === 'hook')
  const hasHeadline = look.firstShotDuration !== null && look.hook.headline !== ''
  const placement = JSON.stringify([
    hasNormalCue ? look.position : null,
    hasHookCue || hasHeadline ? look.hook.position : null,
  ])
  const firstShot = JSON.stringify(extras ? [look.hook.headline, look.hook.punchIn] : null)
  const text = JSON.stringify(translated.map(c => [c.start.toFixed(3), c.end.toFixed(3), c.en, c.ja, c.variant]))
  return {
    slot: `burn:${clip.shotId}`,
    key: `burn|${clipKey(clip)}|${placement}|${firstShot}|${text}`,
    run: (onProgress, signal) =>
      burnShotSubtitles(clip.blob, clip.start, clip.end, translated, look, onProgress, signal),
  }
}
```

In `burnSubtitlesByShot`, change the first line:

```ts
  if (!cues.some(c => c.ja !== null) && !hasFirstShotExtras(hook, firstShotDurationOf(clips))) return combinedBlob
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/utils`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/burnSubtitles.ts src/utils/burnSubtitles.test.ts src/utils/shotEncoding.ts src/utils/shotEncoding.test.ts
git commit -m "feat: burn the hook headline and punch-in on every burn path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Headline in the preview

**Files:**
- Modify: `src/components/SubtitleOverlayPreview.tsx`
- Modify: `src/components/SubtitleOverlayPreview.module.css`
- Modify: `src/components/SubtitleOverlayPreview.test.tsx`

**Interfaces:**
- Consumes: `layoutHeadline`, `HEADLINE_BOX_OPACITY` (Task 3); `headlineY`, `startsInFirstShot` (Task 1); `clampedSubtitleY`, `SUBTITLE_VIDEO_HEIGHT` (Task 1).
- Produces: a `data-testid="hook-headline"` box, shown while `currentTime < firstShotDuration` when `hook.headline` is non-empty.

- [ ] **Step 1: Write the failing tests**

In `src/components/SubtitleOverlayPreview.test.tsx`, add the imports:

```ts
import { createCanvasMeasure, layoutCue, layoutHeadline } from '../utils/subtitleLayout'
import { clampedSubtitleY } from '../utils/subtitlePosition'
import { headlineY } from '../utils/subtitleHook'
```

and append inside the `describe`:

```tsx
  const withHeadline = (headline: string) => ({ ...HOOK, headline })

  it('shows the headline just above the first shot\'s subtitle, as burned in', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={72} currentTime={1} hook={withHeadline('Wait *what*')} firstShotDuration={2} />)
    const measure = createCanvasMeasure()
    const cueTop = clampedSubtitleY(50, layoutCue(CUES[0], measure, 'hook').height)
    const headline = layoutHeadline('Wait *what*', measure)
    const box = screen.getByTestId('hook-headline')
    expect(box.style.top).toBe(`${(headlineY([cueTop], headline.height, 50) / 1920) * 100}%`)
    expect(screen.getByText('what')).toHaveStyle({ color: '#FFD60A' })
  })

  it('hides the headline after the first shot', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={72} currentTime={3} hook={withHeadline('Wait')} firstShotDuration={2} />)
    expect(screen.queryByTestId('hook-headline')).not.toBeInTheDocument()
  })

  it('shows the headline at the hook position when the first shot has no subtitle', () => {
    render(<SubtitleOverlayPreview cues={[]} position={72} currentTime={0.5} hook={withHeadline('Wait')} firstShotDuration={2} />)
    const headline = layoutHeadline('Wait', createCanvasMeasure())
    expect(screen.getByTestId('hook-headline').style.top).toBe(`${(clampedSubtitleY(50, headline.height) / 1920) * 100}%`)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/SubtitleOverlayPreview.test.tsx`
Expected: FAIL (there is no `hook-headline`).

- [ ] **Step 3: Implement**

In `src/components/SubtitleOverlayPreview.tsx`:

1. Extend the imports:

```ts
import { SubtitlePosition, SUBTITLE_VIDEO_HEIGHT, clampedSubtitlePosition, clampedSubtitleY } from '../utils/subtitlePosition'
import { headlineY, startsInFirstShot, styleCues, type HookOptions } from '../utils/subtitleHook'
```

   Also add `HEADLINE_BOX_OPACITY` and `layoutHeadline` to the `subtitleLayout` import.

2. Replace the component body from `const cue = …` to the end:

```tsx
  const cue = styled.find(c => currentTime >= c.start && currentTime < c.end)
  const layout = useMemo(() => (cue ? layoutCue(cue, measure, cue.variant) : null), [cue, measure])

  const headlineText = hook?.headline ?? ''
  const hookPosition = hook?.position ?? position
  // Placed as the burn places it: above the topmost of the first shot's
  // (translated, hence burned) subtitle boxes.
  const headline = useMemo(() => {
    if (!headlineText || firstShotDuration === null) return null
    const headlineLayout = layoutHeadline(headlineText, measure)
    const boxTops = styled
      .filter(c => c.ja !== null && startsInFirstShot(c.start, firstShotDuration))
      .map(c => clampedSubtitleY(c.variant === 'hook' ? hookPosition : position, layoutCue(c, measure, c.variant).height))
    return { layout: headlineLayout, y: headlineY(boxTops, headlineLayout.height, hookPosition) }
  }, [headlineText, firstShotDuration, styled, measure, hookPosition, position])

  const headlineBox = headline && firstShotDuration !== null && currentTime < firstShotDuration && (
    <div
      className={styles.headline}
      data-testid="hook-headline"
      style={{
        top: `${(headline.y / SUBTITLE_VIDEO_HEIGHT) * 100}%`,
        width: cqw(headline.layout.width),
        padding: `${cqw(SUBTITLE_BOX_PADDING_Y)} 0`,
        borderRadius: cqw(SUBTITLE_BOX_RADIUS),
        backgroundColor: `rgba(0, 0, 0, ${HEADLINE_BOX_OPACITY})`,
      }}
    >
      <p className={styles.headlineText} style={blockStyle(headline.layout.block)}>
        <BlockLines block={headline.layout.block} />
      </p>
    </div>
  )

  const cueBox = cue && layout && (
    <div
      className={styles.wrapper}
      style={{
        top: `${clampedSubtitlePosition(cue.variant === 'hook' ? hookPosition : position, layout.height)}%`,
        width: cqw(SUBTITLE_REFERENCE_WIDTH - SUBTITLE_BOX_MARGIN_X * 2),
        padding: `${cqw(SUBTITLE_BOX_PADDING_Y)} ${cqw(SUBTITLE_BOX_PADDING_X)}`,
        borderRadius: cqw(SUBTITLE_BOX_RADIUS),
        backgroundColor: `rgba(0, 0, 0, ${SUBTITLE_BOX_OPACITY[cue.variant]})`,
      }}
      data-testid="subtitle-overlay-box"
      data-variant={cue.variant}
    >
      <p className={styles.en} style={blockStyle(layout.en)}>
        <BlockLines block={layout.en} />
      </p>
      {layout.ja && (
        <p className={styles.ja} style={{ ...blockStyle(layout.ja), marginTop: cqw(SUBTITLE_BLOCK_GAP) }}>
          <BlockLines block={layout.ja} />
        </p>
      )}
    </div>
  )

  if (!headlineBox && !cueBox) return null
  return (
    <>
      {headlineBox}
      {cueBox}
    </>
  )
}
```

(The old `if (!cue || !layout) return null` and the `wrapperStyle` const go away; `hook ? hook.position : position` becomes `hookPosition`, which equals `hook.position` whenever a cue is a hook cue.)

In `src/components/SubtitleOverlayPreview.module.css`, append:

```css
.headline {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  pointer-events: none;
}

.headlineText {
  color: #fff;
  font-weight: 700;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/SubtitleOverlayPreview.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/SubtitleOverlayPreview.tsx src/components/SubtitleOverlayPreview.module.css src/components/SubtitleOverlayPreview.test.tsx
git commit -m "feat: preview the hook headline where it burns in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Headline and punch-in controls, persisted headline

**Files:**
- Modify: `src/components/SubtitleWorkflow.tsx`
- Modify: `src/components/SubtitleWorkflow.module.css`
- Modify: `src/components/SubtitleWorkflow.test.tsx`
- Modify: `src/utils/finalizeProgressStore.ts`
- Modify: `src/pages/FinalizePage.tsx`
- Modify: `src/pages/FinalizePage.test.tsx`

**Interfaces:**
- Consumes: `HookSettings` with the headline/punch-in keys, `hookOptionsOf(settings, headline)` and `punchInScale` (Task 1); the burn paths (Task 5); the preview (Task 6).
- Produces:
  - `SubtitleState.hookHeadline: string` (initial `''`)
  - `SavedSubtitles.hookHeadline?: string`
  - Checkboxes labelled `フック見出し` and `パンチイン`, and a text input labelled `フック見出しのテキスト`.

- [ ] **Step 1: Write the failing tests**

In `src/components/SubtitleWorkflow.test.tsx`, make `ControlledSubtitleWorkflow` burn with the headline it holds in `state`, as FinalizePage does. Change `hook: hookOptionsOf(hookSettings),` in its `burn` prop to:

```tsx
          hook: hookOptionsOf(hookSettings, state.hookHeadline),
```

Then append:

```tsx
describe('SubtitleWorkflow headline and punch-in', () => {
  async function renderTranslated(onHookSettingsChange = vi.fn()) {
    seedBurnMock()
    render(
      <ControlledSubtitleWorkflow
        combinedBlob={BLOB}
        shotCueInputs={SHOT_CUE_INPUTS}
        onBurned={vi.fn()}
        onHookSettingsChange={onHookSettingsChange}
      />,
    )
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    return onHookSettingsChange
  }

  it('shows a typed headline over the first shot, and drops it when switched off', async () => {
    const onChange = await renderTranslated()
    fireEvent.change(screen.getByLabelText('フック見出しのテキスト'), { target: { value: 'Wait' } })
    expect(screen.getByTestId('hook-headline')).toHaveTextContent('Wait')

    fireEvent.click(screen.getByLabelText('フック見出し'))
    expect(onChange).toHaveBeenCalledWith({ hookHeadlineEnabled: false })
    expect(screen.queryByLabelText('フック見出しのテキスト')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hook-headline')).not.toBeInTheDocument()
  })

  it('burns with the headline', async () => {
    await renderTranslated()
    fireEvent.change(screen.getByLabelText('フック見出しのテキスト'), { target: { value: 'Wait' } })
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(burnModule.burnSubtitles).toHaveBeenCalled())
    expect(burnModule.burnSubtitles).toHaveBeenLastCalledWith(
      BLOB,
      expect.anything(),
      expect.objectContaining({ hook: expect.objectContaining({ headline: 'Wait', punchIn: true }) }),
    )
  })

  it('zooms the preview video during the first shot, unless the punch-in is off', async () => {
    const onChange = await renderTranslated()
    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'currentTime', { value: 1, configurable: true })
    fireEvent.timeUpdate(video)
    expect(video.style.transform).toBe('scale(1.04)')

    fireEvent.click(screen.getByLabelText('パンチイン'))
    expect(onChange).toHaveBeenCalledWith({ punchInEnabled: false })
    expect(video.style.transform).toBe('')
  })
})
```

In `src/pages/FinalizePage.test.tsx`, append inside `describe('FinalizePage subtitle step: picks up where it was left')`:

```tsx
  it('reopens with the hook headline kept', async () => {
    await combineAndTranslate()
    fireEvent.change(screen.getByLabelText('フック見出しのテキスト'), { target: { value: 'Wait *what*' } })
    await waitFor(async () =>
      expect((await loadFinalizeProgress('script-1')).subtitles?.hookHeadline).toBe('Wait *what*'),
    )
    cleanup()

    renderFinalizePage('script-1')
    expect(await screen.findByLabelText('フック見出しのテキスト')).toHaveValue('Wait *what*')
  })
```

and append inside `describe('FinalizePage subtitle step: hook on the first shot')`:

```tsx
  it('burns the headline and the punch-in into the first shot', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(burnModule.burnShotSubtitles).mockResolvedValue(new Blob(['burned-shot'], { type: 'video/mp4' }))
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    fireEvent.click(await screen.findByText('次へ'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.change(screen.getByLabelText('フック見出しのテキスト'), { target: { value: 'Wait' } })

    await waitFor(() => {
      const looks = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[4])
      expect(looks[looks.length - 1]).toMatchObject({ hook: { headline: 'Wait', punchIn: true }, firstShotDuration: 5 })
    }, { timeout: 3000 })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx src/pages/FinalizePage.test.tsx`
Expected: FAIL (no headline field, and no punch-in toggle).

- [ ] **Step 3: Implement `SubtitleWorkflow`**

In `src/components/SubtitleWorkflow.tsx`:

1. Change the hook import to `import { hookOptionsOf, punchInScale, type HookSettings } from '../utils/subtitleHook'`.

2. Add to `SubtitleState`:

```ts
  /** On-screen-only text above the first shot's subtitle; per video. */
  hookHeadline: string
```

   and `hookHeadline: '',` to `INITIAL_SUBTITLE_STATE`.

3. Destructure it: `const { stage, cues, pasteText, position, source, hookHeadline } = state`. Replace the `hook`/`firstShotDuration` lines with:

```ts
  const hook = hookOptionsOf(hookSettings, hookHeadline)
  // The first clip of the 結合: hook cues are the ones starting within it.
  const firstShotDuration = shotCueInputs[0]?.duration ?? null
  // The punch-in is previewed by zooming the player itself; the subtitle
  // overlay is a sibling of it, so it keeps its size as in the burn.
  const previewZoom = hook.punchIn && firstShotDuration !== null ? punchInScale(previewTime, firstShotDuration) : 1
```

4. On the preview `<video>`, add:

```tsx
                  style={previewZoom !== 1 ? { transform: `scale(${previewZoom})` } : undefined}
```

5. After the hook position preset row (the `role="group" aria-label="フック字幕の位置"` div), add:

```tsx
              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={hookSettings.hookHeadlineEnabled}
                  onChange={e => onHookSettingsChange({ hookHeadlineEnabled: e.target.checked })}
                />
                フック見出し
              </label>
              {hookSettings.hookHeadlineEnabled && (
                <input
                  className={styles.headlineInput}
                  aria-label="フック見出しのテキスト"
                  placeholder="例: 'carry a torch' ≠ romantic?"
                  value={hookHeadline}
                  onChange={e => patch({ hookHeadline: e.target.value })}
                />
              )}
              <p className={styles.hint}>最初のショットの間だけ、字幕の上に短い見出しを出します（空欄なら出しません。*で囲むと黄色）</p>
              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={hookSettings.punchInEnabled}
                  onChange={e => onHookSettingsChange({ punchInEnabled: e.target.checked })}
                />
                パンチイン
              </label>
              <p className={styles.hint}>最初のショットの映像をゆっくりズームインします（字幕は拡大しません）</p>
```

In `src/components/SubtitleWorkflow.module.css`:
- Add `overflow: hidden;` and `border-radius: 8px;` to `.previewWrapper`, so the zoomed player stays inside its frame.
- Add:

```css
.headlineInput {
  width: 100%;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 8px;
  /* ≥16px, or iOS Safari zooms in on focus and stays zoomed after blur. */
  font-size: 1rem;
}
```

- [ ] **Step 4: Implement the persistence and FinalizePage wiring**

`src/utils/finalizeProgressStore.ts`, add to `SavedSubtitles`:

```ts
  /** The hook headline; missing in records saved before it existed. */
  hookHeadline?: string
```

`src/pages/FinalizePage.tsx`:

1. Read all four hook settings:

```ts
  const { hookStyleEnabled, hookPosition, hookHeadlineEnabled, punchInEnabled } = settings
```

2. Restoring saved subtitles in the load `.then`:

```ts
          const { cues, pasteText, position, source, hookHeadline = '' } = subtitles
          savedSubtitlesRef.current = subtitlesSignatureOf(subtitles)
          setSubtitleState({ stage: cues.length > 0 ? 'reviewing' : 'idle', cues, pasteText, position, source, hookHeadline })
```

3. Add `hookHeadline: subtitleState.hookHeadline,` to `subtitlesToSave`.

4. The memoized hook gains this video's headline (the background-burn effect already depends on `hook`, and the `burn` prop already passes it):

```ts
  const { stage: subtitleStage, cues: subtitleCues, position: subtitlePosition, hookHeadline } = subtitleState
  const hook = useMemo(
    () => hookOptionsOf({ hookStyleEnabled, hookPosition, hookHeadlineEnabled, punchInEnabled }, hookHeadline),
    [hookStyleEnabled, hookPosition, hookHeadlineEnabled, punchInEnabled, hookHeadline],
  )
```

5. Re-combining keeps the headline, since it doesn't depend on timing. Replace `setSubtitleState(initialSubtitleState())` in the combine handler with:

```ts
    // A re-combined video invalidates any subtitle cues tied to the old one;
    // the headline doesn't depend on timing, so it stays.
    setSubtitleState(prev => ({ ...initialSubtitleState(), hookHeadline: prev.hookHeadline }))
```

6. In `<SubtitleWorkflow …>`:

```tsx
                hookSettings={{ hookStyleEnabled, hookPosition, hookHeadlineEnabled, punchInEnabled }}
                onHookSettingsChange={updateSettings}
```

   (the `burn` prop keeps passing the memoized `hook`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx src/pages/FinalizePage.test.tsx src/utils/finalizeProgressStore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/SubtitleWorkflow.tsx src/components/SubtitleWorkflow.module.css src/components/SubtitleWorkflow.test.tsx src/utils/finalizeProgressStore.ts src/pages/FinalizePage.tsx src/pages/FinalizePage.test.tsx
git commit -m "feat: add the hook headline and punch-in to the subtitle step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verify and open PR 2

**Files:** none (fix-ups only if something fails)

- [ ] **Step 1: Full test suite, type-check, lint, build**

Run: `npx vitest run && npx tsc -b && npm run lint && npm run build`
Expected: all pass with no errors.

- [ ] **Step 2: Look at it in the browser**

Add a temporary entry to the main checkout's `.claude/launch.json`:

```json
{ "name": "hook-pr2", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", ".claude/worktrees/hook-headline-punchin", "run", "dev", "--", "--port", "5175"], "port": 5175 }
```

Start it with `preview_start`, then check:
1. 設定 shows 「最初のショットの前に残す時間 0.05秒」.
2. With a recorded script, the 字幕 step's preview shows:
   - the headline above the centered hook subtitle during the first shot only;
   - the video zooming slowly during the first shot, with the subtitles unscaled;
   - the toggles hiding each feature.

Remove the launch entry afterwards.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/hook-headline-punchin
gh pr create --title "feat: hook headline, first-shot lead-in and punch-in" --body "$(cat <<'EOF'
## Summary
- Optional per-video hook headline above the first shot's subtitle, during the first shot only (supports `*emphasis*`), saved with the subtitle work.
- The first shot is auto-trimmed with its own 0.05s lead-in before the speech (Settings → 自動トリミング); a shot's own setting still wins.
- Punch-in: the first shot's picture zooms 1.0→1.08 (subtitles unscaled) on the per-shot and whole-video WebCodecs paths, via zoompan on the ffmpeg fallback, and in the preview.
- フック見出し / パンチイン toggles in the subtitle step, saved in settings.

Spec: docs/superpowers/specs/2026-10-08-hook-first-shot-design.md (items 4–6).

## Test plan
- [ ] `npx vitest run`, `npx tsc -b`, `npm run lint`, `npm run build`
- [ ] On iPhone (Vercel preview, relaunch the home-screen app first): headline shows over the first shot and disappears at the cut; first shot zooms smoothly with crisp, unscaled subtitles; the video opens right on the first word; toggles re-burn only the first shot

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Bind it with the ccd_pr tools. Merge with `gh pr merge --merge` once checks pass and the user approves.
