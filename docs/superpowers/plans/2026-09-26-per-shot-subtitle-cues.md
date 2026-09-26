# Per-Shot Subtitle Cues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one English subtitle cue per shot from that shot's already-known script text and trimmed duration, instead of running Whisper transcription on the combined video.

**Architecture:** Add a pure function `cuesFromShotEntries` that turns an ordered list of `{ text, duration }` shot inputs into `SubtitleCue[]` by accumulating durations into cue offsets. `FinalizePage` computes these inputs (same filter/order/trim values it already uses to build the combined video) and passes them into `SubtitleWorkflow`, which calls the new function instead of `transcribeSpeech` when the user clicks "generate".

**Tech Stack:** React + TypeScript, Vitest + Testing Library, existing `SubtitleCue` type.

## Global Constraints

- Do not change the `SubtitleCue` shape (`{ id, start, end, en, ja }`) — translation, editing, preview, and burn-in all depend on it unchanged.
- Do not delete or modify `src/utils/transcribeSpeech.ts`, `src/workers/whisperWorker.ts`, or `src/utils/transcribeSpeech.test.ts` — leave them in place, unused by this flow.
- No new dependencies.
- Spec: `docs/superpowers/specs/2026-09-26-per-shot-subtitle-cues-design.md`

---

### Task 1: `cuesFromShotEntries` in `subtitleCues.ts`

**Files:**
- Modify: `src/utils/subtitleCues.ts`
- Test: `src/utils/subtitleCues.test.ts`

**Interfaces:**
- Produces: `export interface ShotCueInput { text: string; duration: number }` and `export function cuesFromShotEntries(entries: ShotCueInput[]): SubtitleCue[]`, both from `src/utils/subtitleCues.ts`. Later tasks import both from this module.

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `src/utils/subtitleCues.test.ts` (extend the existing top import line to also bring in `cuesFromShotEntries`):

```ts
import { buildClaudePrompt, parseJapanesePaste, cuesFromShotEntries, type SubtitleCue } from './subtitleCues'
```

(replace the existing `import { buildClaudePrompt, parseJapanesePaste, type SubtitleCue } from './subtitleCues'` line at the top of the file with the line above), then append:

```ts

describe('cuesFromShotEntries', () => {
  it('builds one cue per entry, offsetting start/end by cumulative duration', () => {
    const cues = cuesFromShotEntries([
      { text: 'Hello there', duration: 3 },
      { text: 'This is a test', duration: 2 },
    ])
    expect(cues).toEqual([
      { id: 'shot-0', start: 0, end: 3, en: 'Hello there', ja: null },
      { id: 'shot-1', start: 3, end: 5, en: 'This is a test', ja: null },
    ])
  })

  it('skips entries with blank text but still advances the offset', () => {
    const cues = cuesFromShotEntries([
      { text: '   ', duration: 3 },
      { text: 'Second shot', duration: 2 },
    ])
    expect(cues).toEqual([
      { id: 'shot-1', start: 3, end: 5, en: 'Second shot', ja: null },
    ])
  })

  it('trims surrounding whitespace from the shot text', () => {
    const cues = cuesFromShotEntries([{ text: '  padded  ', duration: 1 }])
    expect(cues[0].en).toBe('padded')
  })

  it('returns an empty array for no entries', () => {
    expect(cuesFromShotEntries([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/subtitleCues.test.ts`
Expected: FAIL — `cuesFromShotEntries` is not exported from `./subtitleCues`.

- [ ] **Step 3: Implement `cuesFromShotEntries`**

Append to `src/utils/subtitleCues.ts`:

```ts

export interface ShotCueInput {
  text: string
  duration: number
}

export function cuesFromShotEntries(entries: ShotCueInput[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let offset = 0
  entries.forEach((entry, i) => {
    const text = entry.text.trim()
    if (text) {
      cues.push({ id: `shot-${i}`, start: offset, end: offset + entry.duration, en: text, ja: null })
    }
    offset += entry.duration
  })
  return cues
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/subtitleCues.test.ts`
Expected: PASS (all tests in the file, including the pre-existing `buildClaudePrompt`/`parseJapanesePaste` ones).

- [ ] **Step 5: Commit**

```bash
git add src/utils/subtitleCues.ts src/utils/subtitleCues.test.ts
git commit -m "feat: add cuesFromShotEntries for per-shot subtitle timing"
```

---

### Task 2: `SubtitleWorkflow` generates cues from shot inputs instead of transcribing

**Files:**
- Modify: `src/components/SubtitleWorkflow.tsx`
- Test: `src/components/SubtitleWorkflow.test.tsx`

**Interfaces:**
- Consumes: `ShotCueInput`, `cuesFromShotEntries` from `src/utils/subtitleCues.ts` (Task 1).
- Produces: `SubtitleWorkflowProps` gains a required `shotCueInputs: ShotCueInput[]` field. `FinalizePage` (Task 3) passes this prop.

- [ ] **Step 1: Write the failing test (rewrite the test file)**

Replace the entire contents of `src/components/SubtitleWorkflow.test.tsx` with:

```tsx
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SubtitleWorkflow, { INITIAL_SUBTITLE_STATE, SubtitleState } from './SubtitleWorkflow'
import { ShotCueInput } from '../utils/subtitleCues'
import * as burnModule from '../utils/burnSubtitles'

vi.mock('../utils/burnSubtitles')

const BLOB = new Blob(['x'], { type: 'video/mp4' })
const SHOT_CUE_INPUTS: ShotCueInput[] = [{ text: 'Hello', duration: 2 }]

function seedBurnMock() {
  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['out'], { type: 'video/mp4' }))
}

// SubtitleWorkflow is a controlled component (state/onStateChange lifted up
// to FinalizePage, so subtitle work survives the component unmounting on
// wizard back-navigation). This wrapper mirrors how FinalizePage drives it.
function ControlledSubtitleWorkflow({
  combinedBlob,
  shotCueInputs,
  onBurned,
}: {
  combinedBlob: Blob
  shotCueInputs: ShotCueInput[]
  onBurned: (blob: Blob) => void
}) {
  const [state, setState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
  return (
    <SubtitleWorkflow
      combinedBlob={combinedBlob}
      shotCueInputs={shotCueInputs}
      state={state}
      onStateChange={setState}
      onBurned={onBurned}
    />
  )
}

describe('SubtitleWorkflow position controls', () => {
  it('defaults to the bottom preset and burns in with it when advancing', async () => {
    seedBurnMock()
    const onBurned = vi.fn()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={onBurned} />)

    fireEvent.click(screen.getByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')

    // Apply a Japanese translation via the paste box so the position/burn UI appears
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    expect(screen.getByText('下部')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(onBurned).toHaveBeenCalled())
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(
      BLOB,
      expect.anything(),
      72.2917,
    )
  })

  it('reveals a percent slider when the fine-tune toggle is switched on, and burns in with its value', async () => {
    seedBurnMock()
    const onBurned = vi.fn()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={onBurned} />)

    fireEvent.click(screen.getByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    fireEvent.click(screen.getByText('細かく調整'))
    const slider = screen.getByLabelText('字幕の上下位置')
    fireEvent.change(slider, { target: { value: '30' } })

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(onBurned).toHaveBeenCalled())
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(BLOB, expect.anything(), 30)
  })

  it('does not render a save button', async () => {
    seedBurnMock()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} />)
    fireEvent.click(screen.getByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(screen.queryByText('保存する')).not.toBeInTheDocument())
  })

  it('shows an inline error and lets the user retry burn-in after a failure, without losing cues', async () => {
    seedBurnMock()
    vi.mocked(burnModule.burnSubtitles).mockRejectedValueOnce(new Error('boom'))
    const onBurned = vi.fn()
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={onBurned} />)

    fireEvent.click(screen.getByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText(/エラーが発生しました/)

    // The review/position UI must still be rendered (not replaced by an
    // error-only screen), with the cues and position controls intact.
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument()
    expect(screen.getByText('下部')).toBeInTheDocument()
    const nextBtn = screen.getByText('次へ')
    expect(nextBtn).not.toBeDisabled()

    // Retrying should succeed now that the mock no longer rejects.
    fireEvent.click(nextBtn)
    await waitFor(() => expect(onBurned).toHaveBeenCalled())
  })

  it('generates a cue per shot from script text, timed by cumulative shot duration', async () => {
    seedBurnMock()
    render(
      <ControlledSubtitleWorkflow
        combinedBlob={BLOB}
        shotCueInputs={[
          { text: 'First shot line', duration: 3 },
          { text: '   ', duration: 1 },
          { text: 'Third shot line', duration: 2 },
        ]}
        onBurned={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('First shot line')
    // The blank-text second shot produced no cue, but its duration still
    // shifted the third shot's cue forward (asserted via the editor input
    // for the third cue existing at all — full offset math is covered by
    // cuesFromShotEntries's own unit tests).
    expect(screen.getByDisplayValue('Third shot line')).toBeInTheDocument()
    expect(screen.getAllByDisplayValue(/shot line/)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx`
Expected: FAIL — `SubtitleWorkflow` does not accept a `shotCueInputs` prop yet (TypeScript error) and/or clicking generate still calls the now-unmocked `transcribeSpeech`, which will throw or hang since it's no longer mocked.

- [ ] **Step 3: Update `SubtitleWorkflow.tsx`**

Replace the import block at the top of `src/components/SubtitleWorkflow.tsx` (lines 1-13):

```tsx
import { useState, useEffect } from 'react'
import { SubtitleCue, ShotCueInput, buildClaudePrompt, cuesFromShotEntries, parseJapanesePaste } from '../utils/subtitleCues'
import { burnSubtitles } from '../utils/burnSubtitles'
import {
  SubtitlePosition,
  SUBTITLE_POSITION_TOP,
  SUBTITLE_POSITION_CENTER,
  SUBTITLE_POSITION_BOTTOM,
} from '../utils/subtitlePosition'
import SubtitleEditor from './SubtitleEditor'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import styles from './SubtitleWorkflow.module.css'
```

Replace the `SubtitleWorkflowProps` interface (currently lines 42-47):

```tsx
interface SubtitleWorkflowProps {
  combinedBlob: Blob
  shotCueInputs: ShotCueInput[]
  state: SubtitleState
  onStateChange: (updater: SubtitleState | ((prev: SubtitleState) => SubtitleState)) => void
  onBurned?: (blob: Blob) => void
}
```

Replace the component signature (currently line 55):

```tsx
export default function SubtitleWorkflow({ combinedBlob, shotCueInputs, state, onStateChange, onBurned }: SubtitleWorkflowProps) {
```

Replace `handleGenerate` (currently lines 81-91):

```tsx
  function handleGenerate() {
    patch({ cues: cuesFromShotEntries(shotCueInputs), stage: 'reviewing' })
  }
```

Remove the now-dead `'transcribing'` stage message block (currently lines 150-152):

```tsx
      {stage === 'transcribing' && (
        <p className={styles.sectionTitle}>字幕を生成中...（初回はモデルのダウンロードが入ります）</p>
      )}
```

Delete that block entirely (leave the `{stage === 'idle' && (...)}` button block immediately above it untouched).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/SubtitleWorkflow.tsx src/components/SubtitleWorkflow.test.tsx
git commit -m "feat: generate subtitle cues from shot script text instead of transcribing"
```

---

### Task 3: `FinalizePage` computes and passes per-shot cue inputs

**Files:**
- Modify: `src/pages/FinalizePage.tsx`
- Test: `src/pages/FinalizePage.test.tsx`

**Interfaces:**
- Consumes: `ShotCueInput` from `src/utils/subtitleCues.ts` (Task 1); `SubtitleWorkflowProps.shotCueInputs` (Task 2).

- [ ] **Step 1: Write the failing tests (edit the test file)**

In `src/pages/FinalizePage.test.tsx`, remove the now-unused transcription mock. Replace the top import block (currently lines 1-24):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IDBFactory } from 'fake-indexeddb'
import FinalizePage from './FinalizePage'
import { Script } from '../types'
import { saveShotVideo } from '../utils/shotVideoStore'
import * as burnModule from '../utils/burnSubtitles'
import * as mixModule from '../utils/mixMusic'
import { MUSIC_TRACKS } from '../data/musicTracks'

vi.mock('../utils/burnSubtitles')
vi.mock('../utils/mixMusic')
vi.mock('../utils/concatVideos', () => ({
  concatVideos: vi.fn(async (blobs: Blob[]) => new Blob(blobs, { type: 'video/mp4' })),
}))
vi.mock('../utils/trimAndNormalizeShot', () => ({
  trimAndNormalizeShot: vi.fn(async (blob: Blob) => blob),
}))
vi.mock('../utils/shareOrDownload', () => ({
  shareOrDownload: vi.fn(async () => true),
}))
```

Replace the `beforeEach` block (currently lines 50-66), dropping the `transcribeModule` mock setup:

```tsx
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  vi.clearAllMocks()
  const script = seedScript()
  await saveShotVideo(script.id, SHOT_1, new Blob(['shot'], { type: 'video/mp4' }))

  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['burned'], { type: 'video/mp4' }))
  vi.mocked(mixModule.mixMusic).mockResolvedValue(new Blob(['mixed'], { type: 'video/mp4' }))
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['track'], { type: 'audio/mpeg' })),
  }) as unknown as typeof fetch
})
```

Now every remaining test's `await screen.findByDisplayValue('Hello')` must change to the seeded shot's actual script text, `'ショット1'` (the cue's `en` now comes from `Shot.text`, not a mocked transcription result). Apply this replacement in all 4 remaining occurrences (in the tests `'walks trim → combine → subtitle → BGM skip → export...'`, `'clicking a completed step...'`, `'never feeds MusicMixer...'`, and `'preserves subtitle work...'`):

Change:
```tsx
    fireEvent.click(await screen.findByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')
```
to:
```tsx
    fireEvent.click(await screen.findByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('ショット1')
```

In the `'preserves subtitle work (cues) when navigating back...'` test, also update the later assertion that re-checks the same text (currently around line 217):
```tsx
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
```
to:
```tsx
    expect(await screen.findByDisplayValue('ショット1')).toBeInTheDocument()
```

Finally, replace the entire `'blocks wizard step navigation while a transcription is in flight'` test (currently lines 232-272) — subtitle generation is now a synchronous computation with no in-flight state to block on, so this test's premise no longer holds. Replace it with an equivalent test covering the still-async burn-in step, which the old test never actually covered:

```tsx
  it('blocks wizard step navigation while a burn-in is in flight', async () => {
    let resolveBurn: (blob: Blob) => void = () => {}
    vi.mocked(burnModule.burnSubtitles).mockReturnValue(
      new Promise(resolve => {
        resolveBurn = resolve
      })
    )

    renderFinalizePage('script-1')

    // Step 1: trim/combine
    await screen.findByText('1. ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, then kick off burn-in but don't resolve it yet.
    fireEvent.click(await screen.findByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText('焼き込み中...')

    // While pending, the wizard indicator's completed 'trim' step must be
    // disabled, and clicking it must not navigate away.
    const trimStep = screen.getByText('トリミング').closest('button')!
    expect(trimStep).toBeDisabled()
    fireEvent.click(trimStep)
    expect(screen.queryByText('結合する')).not.toBeInTheDocument()
    expect(screen.getByText('焼き込み中...')).toBeInTheDocument()

    // The page's own back button should also be disabled while processing.
    expect(screen.getByText('‹ 戻る')).toBeDisabled()

    // Resolve the burn-in and confirm the flow completes normally, with
    // navigation re-enabled afterwards.
    resolveBurn(new Blob(['burned'], { type: 'video/mp4' }))
    await screen.findByText('BGMなしで進む')
    expect(screen.getByText('トリミング').closest('button')).not.toBeDisabled()
    expect(screen.getByText('‹ 戻る')).not.toBeDisabled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/FinalizePage.test.tsx`
Expected: FAIL — cues still come from nowhere (no `shotCueInputs` wired up), so no `SubtitleCue` is generated and `screen.findByDisplayValue('ショット1')` times out; the new burn-in-blocking test fails because `subtitleProcessing` doesn't yet cover the new flow correctly (it already covers `'burning'`, but the generate step itself won't produce cues without Task 3's wiring, so the test can't even reach burn-in).

- [ ] **Step 3: Update `FinalizePage.tsx`**

Add `ShotCueInput` to the existing `subtitleCues` import. `FinalizePage.tsx` doesn't currently import from `subtitleCues` — add a new import line right after the existing `SubtitleWorkflow` import (currently line 9):

```tsx
import SubtitleWorkflow, { INITIAL_SUBTITLE_STATE, SubtitleState } from '../components/SubtitleWorkflow'
import { ShotCueInput } from '../utils/subtitleCues'
```

Add a new state variable next to `combinedBlob` (currently line 40):

```tsx
  const [combinedBlob, setCombinedBlob] = useState<Blob | null>(null)
  const [shotCueInputs, setShotCueInputs] = useState<ShotCueInput[]>([])
```

Replace `handleCombine` (currently lines 147-175) to also compute and store the cue inputs on success:

```tsx
  async function handleCombine() {
    setCombineState('combining')
    setCombineError(null)
    // Re-combining invalidates any later step's output. `completedSteps`
    // never contains 'subtitle'/'bgm' while sitting on 'trim' (the only way
    // back here is goToStep, which already truncates completedSteps), so
    // clearing the blobs is sufficient — no completedSteps update needed.
    setBurnedBlob(null)
    setMixedBlob(null)
    // A re-combined video invalidates any transcription tied to the old one.
    setSubtitleState(INITIAL_SUBTITLE_STATE)
    try {
      const normalized: Blob[] = []
      for (const entry of availableEntries) {
        const trimmed = await trimAndNormalizeShot(entry.blob!, entry.trimStart, entry.trimEnd || entry.duration)
        normalized.push(trimmed)
      }
      const combined = await concatVideos(normalized)
      if (combinedUrlRef.current) URL.revokeObjectURL(combinedUrlRef.current)
      const url = URL.createObjectURL(combined)
      combinedUrlRef.current = url
      setCombinedBlob(combined)
      setCombinedUrl(url)
      // Same entries, same order, same trim values used just above to build
      // `normalized` — keeps subtitle timing aligned with the actual output.
      setShotCueInputs(
        availableEntries.map(entry => ({
          text: entry.text,
          duration: (entry.trimEnd || entry.duration) - entry.trimStart,
        }))
      )
      setCombineState('done')
    } catch (err) {
      setCombineError(err instanceof Error ? err.message : String(err))
      setCombineState('error')
    }
  }
```

Update the `subtitleProcessing` comment and check (currently lines 115-120) — subtitle generation is synchronous now, so only burn-in has an in-flight state to guard against:

```tsx
  // Block back-navigation via the wizard indicator (and the page's own back
  // button) while a burn-in is in flight: it updates lifted subtitle state
  // after its await resolves, and navigating away mid-flight (especially
  // re-combining, which resets that lifted state) can leave the eventual
  // resolution merging onto a state it no longer matches.
  const subtitleProcessing = subtitleState.stage === 'burning'
```

Pass the new prop to `SubtitleWorkflow` (currently lines 264-276):

```tsx
          {step === 'subtitle' && combinedBlob && (
            <div className={styles.stepBody}>
              <SubtitleWorkflow
                key={combinedUrl}
                combinedBlob={combinedBlob}
                shotCueInputs={shotCueInputs}
                state={subtitleState}
                onStateChange={setSubtitleState}
                onBurned={burned => {
                  setBurnedBlob(burned)
                  markStepDone('subtitle', 'bgm')
                }}
              />
            </div>
          )}
```

Finally, remove the now-unused `'transcribing'` member from `SubtitleStage` in `src/components/SubtitleWorkflow.tsx` (nothing sets it anymore after Task 2's `handleGenerate` change) — change:

```tsx
export type SubtitleStage = 'idle' | 'transcribing' | 'reviewing' | 'burning'
```
to:
```tsx
export type SubtitleStage = 'idle' | 'reviewing' | 'burning'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/FinalizePage.test.tsx`
Expected: PASS (all 6 tests, including the new burn-in-blocking test).

Then run the full suite to confirm nothing else regressed:

Run: `npx vitest run`
Expected: PASS across all test files (in particular `src/utils/subtitleCues.test.ts`, `src/components/SubtitleWorkflow.test.tsx`, `src/utils/transcribeSpeech.test.ts` — the last one must be untouched and still green, confirming the Whisper code path was left intact).

Then verify the type-check build still passes end to end (per this project's existing convention: `tsc --noEmit -p .` doesn't reliably check this project — use build mode):

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FinalizePage.tsx src/pages/FinalizePage.test.tsx src/components/SubtitleWorkflow.tsx
git commit -m "feat: wire per-shot subtitle cue inputs from FinalizePage into SubtitleWorkflow"
```

---

## Self-Review Notes

- **Spec coverage:** Text source (Task 1 uses `entry.text` verbatim) ✓. One cue per shot, whole-shot duration (Task 1's `cuesFromShotEntries`) ✓. Timing via accumulated trim-order durations matching `concatVideos` input (Task 3's `shotCueInputs` built from the same `availableEntries`/trim values as `normalized`) ✓. Blank text skipped, offset still advances (Task 1, tested) ✓. Whisper files untouched (explicitly called out in Global Constraints and Task 3 Step 4's full-suite run) ✓. Translation/editing/burn-in untouched (`SubtitleCue` shape unchanged, no edits to `SubtitleEditor`, `burnSubtitles`, or the paste/translation code in `SubtitleWorkflow.tsx`) ✓.
- **Type consistency:** `ShotCueInput` defined once in Task 1 (`subtitleCues.ts`) and imported by name, unchanged, in Tasks 2 and 3. `cuesFromShotEntries` signature (`(entries: ShotCueInput[]) => SubtitleCue[]`) matches its one call site in Task 2's `handleGenerate`.
- **No placeholders:** every step shows complete, exact code (no "add error handling" or "similar to Task N" shorthand).
