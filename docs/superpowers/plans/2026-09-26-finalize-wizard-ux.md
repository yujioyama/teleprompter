# Finalize Wizard UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single long-scrolling Finalize page into a 4-step wizard
(Trim & Combine → Subtitle → BGM → Export) with exactly one save action,
genre-filterable BGM selection with auto-preview mixing, and a subtitle
position control that adds a fine-tune percent slider alongside the existing
3 presets.

**Architecture:** `FinalizePage` becomes a thin wizard shell owning
`step` state and every intermediate blob (`combinedBlob`, `burnedBlob`,
`mixedBlob`); it renders exactly one step's UI at a time via a new
`WizardSteps` progress component. `SubtitleWorkflow` and `MusicMixer` keep
their existing internal stage machinery but stop rendering their own save
buttons and instead call a completion callback (`onBurned` / `onMixed`) that
the shell uses to store the blob and advance `step`. Subtitle position
becomes a plain 0–100 percent number (replacing the 3-value string union)
so the same state can back both the preset buttons and a new slider; a new
`SubtitleOverlayPreview` component renders a CSS approximation of the
burned-in subtitle over the raw video for instant feedback, so the actual
(expensive) `burnSubtitles` FFmpeg call still runs exactly once per subtitle
step, on "次へ".

**Tech Stack:** React + TypeScript, Vite, Vitest + @testing-library/react +
jsdom, CSS Modules, ffmpeg.wasm (unchanged, invoked via existing
`burnSubtitles`/`mixMusic` utils).

## Global Constraints

- Follow existing code style: CSS Modules per component (`X.module.css`),
  function components with named `handleX` functions, no default exports
  changed to named.
- All new components get co-located `.module.css` files, matching every
  existing component in `src/components/`.
- Tests use Vitest + `@testing-library/react`, `describe`/`it`/`expect`
  imported explicitly (matching `RecordPage.test.tsx`), rendered inside
  `MemoryRouter` only where the component under test uses routing (the new
  components here do not route, so plain `render()` is enough).
- Reference video geometry used by `burnSubtitles` is fixed at
  `VIDEO_WIDTH = 1080`, `VIDEO_HEIGHT = 1920`, `OVERLAY_HEIGHT = 220`
  (`src/utils/burnSubtitles.ts:118-120`) — the subtitle position presets
  must reproduce today's exact burned-in pixel position at these fixed
  values, not for arbitrary video sizes.
- No new dependencies (no drag library, no state library) — everything here
  is plain React state + CSS.

---

## File Structure

| File | Status | Responsibility |
|------|--------|-----------------|
| `src/utils/subtitlePosition.ts` | Modify | `SubtitlePosition` becomes `number` (0-100 percent); `subtitleY` becomes a single linear formula; export 3 preset percent constants. |
| `src/utils/subtitlePosition.test.ts` | Modify | Rewrite for the numeric formula + preset constants. |
| `src/components/SubtitleOverlayPreview.tsx` | Create | Lightweight CSS-only preview of the current cue's bilingual subtitle box, positioned at a given percent, over a `<video>` element. |
| `src/components/SubtitleOverlayPreview.module.css` | Create | Styling to visually approximate the real burned-in box. |
| `src/components/SubtitleOverlayPreview.test.tsx` | Create | Verifies positioning and cue-text rendering. |
| `src/components/SubtitleWorkflow.tsx` | Modify | Add fine-tune toggle + slider bound to the numeric position; render `SubtitleOverlayPreview` during review; drop the burned-video save button; drop `filenameBase` prop. |
| `src/components/SubtitleWorkflow.module.css` | Modify | Add styles for the fine-tune toggle/slider. |
| `src/components/MusicPicker.tsx` | Modify | Add a genre `<select>`; only render tracks of the selected genre; changing genre clears selection. |
| `src/components/MusicPicker.module.css` | Modify | Add select styling. |
| `src/components/MusicPicker.test.tsx` | Create | Genre filtering + selection-clear-on-genre-change behavior. |
| `src/components/MusicMixer.tsx` | Modify | Drop the "BGMを合成する" button and internal save button; auto-mix (debounced) on track/volume change; add `onMixed`/`onNext` callback props; add "BGMなしで進む" skip action; drop `filenameBase` prop. |
| `src/components/MusicMixer.module.css` | Modify | Add skip-button + status-text styles, drop unused save-button style if no longer referenced. |
| `src/components/MusicMixer.test.tsx` | Create | Auto-mix-on-select, debounce-on-volume-drag, skip flow. |
| `src/components/WizardSteps.tsx` | Create | 4-dot progress indicator; highlights current step, checkmarks completed steps, lets the user click back to a completed step. |
| `src/components/WizardSteps.module.css` | Create | Styling for the dots/labels. |
| `src/components/WizardSteps.test.tsx` | Create | Renders correct current/completed state; click-back behavior. |
| `src/pages/FinalizePage.tsx` | Modify | Restructure into the 4-step wizard shell described above. |
| `src/pages/FinalizePage.module.css` | Modify | Add step-body wrapper styles; drop now-unused mid-page save-button style if superseded. |
| `src/pages/FinalizePage.test.tsx` | Create | End-to-end wizard flow test (trim → combine → subtitle → BGM skip → export → save), using the same `fake-indexeddb` + `MemoryRouter` pattern as `RecordPage.test.tsx`. |

---

### Task 1: Numeric subtitle position

**Files:**
- Modify: `src/utils/subtitlePosition.ts`
- Test: `src/utils/subtitlePosition.test.ts`

**Interfaces:**
- Produces: `export type SubtitlePosition = number` (0–100, percent of video
  height for the overlay's vertical anchor); `export function subtitleY(position: SubtitlePosition, videoHeight: number, overlayHeight: number): number`; `export const SUBTITLE_POSITION_TOP = 13.75`; `export const SUBTITLE_POSITION_CENTER = 50`; `export const SUBTITLE_POSITION_BOTTOM = 72.2917`.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `src/utils/subtitlePosition.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import {
  subtitleY,
  SUBTITLE_POSITION_TOP,
  SUBTITLE_POSITION_CENTER,
  SUBTITLE_POSITION_BOTTOM,
} from './subtitlePosition'

describe('subtitleY', () => {
  it('computes the Y coordinate as a percent of video height, offset by half the overlay height', () => {
    expect(subtitleY(50, 1920, 220)).toBe(850) // round(1920 * 0.5 - 110)
  })

  it('rounds to the nearest pixel', () => {
    expect(subtitleY(10, 1000, 100)).toBe(50) // round(1000 * 0.1 - 50)
  })

  it('clamps at 0 percent to just above negative half the overlay height', () => {
    expect(subtitleY(0, 1920, 220)).toBe(-110)
  })
})

describe('preset percent constants', () => {
  // At the production reference geometry (VIDEO_HEIGHT=1920, OVERLAY_HEIGHT=220,
  // from src/utils/burnSubtitles.ts), each preset must reproduce the exact pixel
  // position the old 3-value-enum formula produced, so switching to a numeric
  // percent doesn't visually shift any existing preset.
  const REF_HEIGHT = 1920
  const REF_OVERLAY = 220

  it('top preset matches the legacy round(videoHeight * 0.08) result', () => {
    expect(subtitleY(SUBTITLE_POSITION_TOP, REF_HEIGHT, REF_OVERLAY)).toBe(154)
  })

  it('center preset matches the legacy round((videoHeight - overlayHeight) / 2) result', () => {
    expect(subtitleY(SUBTITLE_POSITION_CENTER, REF_HEIGHT, REF_OVERLAY)).toBe(850)
  })

  it('bottom preset matches the legacy round(videoHeight * 0.78 - overlayHeight) result', () => {
    expect(subtitleY(SUBTITLE_POSITION_BOTTOM, REF_HEIGHT, REF_OVERLAY)).toBe(1278)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/subtitlePosition.test.ts`
Expected: FAIL — `subtitleY` still takes a string union and the new named
exports don't exist (TypeScript/import errors).

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/utils/subtitlePosition.ts` with:

```ts
/** Percent of video height (0-100) marking the overlay's vertical anchor point. */
export type SubtitlePosition = number

/**
 * Preset percent values reproducing the exact pixel positions the old
 * top/center/bottom 3-value enum produced, at the production reference
 * geometry (VIDEO_HEIGHT=1920, OVERLAY_HEIGHT=220 in burnSubtitles.ts):
 * old top = round(1920*0.08) = 154, old center = round((1920-220)/2) = 850,
 * old bottom = round(1920*0.78-220) = 1278. Solving y = round(H*p/100 - overlayHeight/2)
 * for p at H=1920, overlayHeight=220 gives the constants below.
 */
export const SUBTITLE_POSITION_TOP = 13.75
export const SUBTITLE_POSITION_CENTER = 50
export const SUBTITLE_POSITION_BOTTOM = 72.2917

/** Pure: compute the overlay's Y coordinate for a vertical position percent (0-100). */
export function subtitleY(position: SubtitlePosition, videoHeight: number, overlayHeight: number): number {
  return Math.round((videoHeight * position) / 100 - overlayHeight / 2)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/subtitlePosition.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/subtitlePosition.ts src/utils/subtitlePosition.test.ts
git commit -m "$(cat <<'EOF'
refactor: change subtitle position from 3-value enum to percent number

Enables a fine-tune slider alongside the existing top/center/bottom
presets without changing the burned-in pixel position those presets
produce today.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `SubtitleOverlayPreview` component

**Files:**
- Create: `src/components/SubtitleOverlayPreview.tsx`
- Create: `src/components/SubtitleOverlayPreview.module.css`
- Test: `src/components/SubtitleOverlayPreview.test.tsx`

**Interfaces:**
- Consumes: `SubtitleCue` from `src/utils/subtitleCues.ts` (`{ id, start, end, en, ja }`); `SubtitlePosition` (`number`) from `src/utils/subtitlePosition.ts`.
- Produces: `export default function SubtitleOverlayPreview(props: { cues: SubtitleCue[]; position: SubtitlePosition; currentTime: number }): JSX.Element` — renders `null`-safe (no crash) when no cue matches `currentTime`.

- [ ] **Step 1: Write the failing test**

Create `src/components/SubtitleOverlayPreview.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import { SubtitleCue } from '../utils/subtitleCues'

const CUES: SubtitleCue[] = [
  { id: 'c1', start: 0, end: 2, en: 'Hello there', ja: 'こんにちは' },
  { id: 'c2', start: 2, end: 4, en: 'General Kenobi', ja: 'ケノービ将軍' },
]

describe('SubtitleOverlayPreview', () => {
  it('renders the cue whose start/end window contains currentTime', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={50} currentTime={1} />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
    expect(screen.getByText('こんにちは')).toBeInTheDocument()
    expect(screen.queryByText('General Kenobi')).not.toBeInTheDocument()
  })

  it('switches to the next cue once currentTime passes into its window', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={50} currentTime={3} />)
    expect(screen.getByText('General Kenobi')).toBeInTheDocument()
    expect(screen.queryByText('Hello there')).not.toBeInTheDocument()
  })

  it('renders nothing when currentTime matches no cue', () => {
    const { container } = render(<SubtitleOverlayPreview cues={CUES} position={50} currentTime={10} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('positions the overlay at the given percent from the top', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={72} currentTime={1} />)
    const box = screen.getByTestId('subtitle-overlay-box')
    expect(box.style.top).toBe('72%')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SubtitleOverlayPreview.test.tsx`
Expected: FAIL — module `./SubtitleOverlayPreview` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/SubtitleOverlayPreview.tsx`:

```tsx
import { SubtitleCue } from '../utils/subtitleCues'
import { SubtitlePosition } from '../utils/subtitlePosition'
import styles from './SubtitleOverlayPreview.module.css'

interface SubtitleOverlayPreviewProps {
  cues: SubtitleCue[]
  position: SubtitlePosition
  currentTime: number
}

/**
 * Cheap DOM/CSS approximation of the real burned-in subtitle box, positioned
 * at the same vertical percent the real burn-in will use. Lets the user see
 * where the subtitle will land without re-running the expensive FFmpeg
 * burn-in on every position change.
 */
export default function SubtitleOverlayPreview({ cues, position, currentTime }: SubtitleOverlayPreviewProps) {
  const cue = cues.find(c => currentTime >= c.start && currentTime < c.end)
  if (!cue) return null

  return (
    <div className={styles.wrapper} style={{ top: `${position}%` }} data-testid="subtitle-overlay-box">
      <p className={styles.en}>{cue.en}</p>
      {cue.ja && <p className={styles.ja}>{cue.ja}</p>}
    </div>
  )
}
```

Create `src/components/SubtitleOverlayPreview.module.css`:

```css
.wrapper {
  position: absolute;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 16px;
  padding: 12px 16px;
  text-align: center;
  pointer-events: none;
}

.en {
  color: #fff;
  font-weight: 700;
  font-size: 1rem;
}

.ja {
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.8rem;
  margin-top: 4px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/SubtitleOverlayPreview.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/SubtitleOverlayPreview.tsx src/components/SubtitleOverlayPreview.module.css src/components/SubtitleOverlayPreview.test.tsx
git commit -m "$(cat <<'EOF'
feat: add lightweight CSS subtitle position preview

Gives instant feedback while adjusting subtitle position without
re-running the expensive FFmpeg burn-in on every change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Subtitle fine-tune slider in `SubtitleWorkflow`

**Files:**
- Modify: `src/components/SubtitleWorkflow.tsx`
- Modify: `src/components/SubtitleWorkflow.module.css`
- Test: `src/components/SubtitleWorkflow.test.tsx` (new)

**Interfaces:**
- Consumes: `SUBTITLE_POSITION_TOP/CENTER/BOTTOM`, `SubtitlePosition` (Task 1); `SubtitleOverlayPreview` (Task 2, `props: { cues, position, currentTime }`).
- Produces: `SubtitleWorkflowProps` drops `filenameBase`; keeps `combinedBlob: Blob` and `onBurned?: (blob: Blob) => void` — callers must react to `onBurned` firing as "this step is complete", since the internal save button is removed.

- [ ] **Step 1: Write the failing test**

Create `src/components/SubtitleWorkflow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SubtitleWorkflow from './SubtitleWorkflow'
import * as transcribeModule from '../utils/transcribeSpeech'
import * as burnModule from '../utils/burnSubtitles'

vi.mock('../utils/transcribeSpeech')
vi.mock('../utils/burnSubtitles')

const BLOB = new Blob(['x'], { type: 'video/mp4' })

function seedOneTranslatedCue() {
  vi.mocked(transcribeModule.transcribeSpeech).mockResolvedValue([
    { id: 'c1', start: 0, end: 2, en: 'Hello', ja: null },
  ])
  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['out'], { type: 'video/mp4' }))
}

describe('SubtitleWorkflow position controls', () => {
  it('defaults to the bottom preset and burns in with it when advancing', async () => {
    seedOneTranslatedCue()
    const onBurned = vi.fn()
    render(<SubtitleWorkflow combinedBlob={BLOB} onBurned={onBurned} />)

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
    seedOneTranslatedCue()
    const onBurned = vi.fn()
    render(<SubtitleWorkflow combinedBlob={BLOB} onBurned={onBurned} />)

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
    seedOneTranslatedCue()
    render(<SubtitleWorkflow combinedBlob={BLOB} onBurned={vi.fn()} />)
    fireEvent.click(screen.getByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(screen.queryByText('保存する')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx`
Expected: FAIL — button text is still "字幕を焼き込む" (not "次へ"), no "細かく調整" toggle exists, and a "保存する" button is still present after burn-in.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/components/SubtitleWorkflow.tsx` with:

```tsx
import { useState } from 'react'
import { SubtitleCue, buildClaudePrompt, parseJapanesePaste } from '../utils/subtitleCues'
import { transcribeSpeech } from '../utils/transcribeSpeech'
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

interface SubtitleWorkflowProps {
  combinedBlob: Blob
  onBurned?: (blob: Blob) => void
}

type Stage = 'idle' | 'transcribing' | 'reviewing' | 'burning' | 'error'

const PRESETS: { label: string; value: SubtitlePosition }[] = [
  { label: '上部', value: SUBTITLE_POSITION_TOP },
  { label: '中央', value: SUBTITLE_POSITION_CENTER },
  { label: '下部', value: SUBTITLE_POSITION_BOTTOM },
]

export default function SubtitleWorkflow({ combinedBlob, onBurned }: SubtitleWorkflowProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [position, setPosition] = useState<SubtitlePosition>(SUBTITLE_POSITION_BOTTOM)
  const [fineTune, setFineTune] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  const previewUrl = URL.createObjectURL(combinedBlob)

  async function handleGenerate() {
    setStage('transcribing')
    setErrorMessage(null)
    try {
      const generated = await transcribeSpeech(combinedBlob)
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
      onBurned?.(burned)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
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

      {(stage === 'reviewing' || stage === 'burning') && cues.length > 0 && (
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
              <p className={styles.sectionTitle}>プレビュー</p>
              <div className={styles.previewWrapper}>
                <video
                  className={styles.preview}
                  src={previewUrl}
                  controls
                  playsInline
                  onTimeUpdate={e => setPreviewTime(e.currentTarget.currentTime)}
                />
                <SubtitleOverlayPreview cues={cues} position={position} currentTime={previewTime} />
              </div>

              <p className={styles.sectionTitle}>字幕の位置</p>
              <div className={styles.positionRow}>
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    className={`${styles.positionBtn} ${position === p.value ? styles.positionBtnActive : ''}`}
                    aria-pressed={position === p.value}
                    onClick={() => setPosition(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <button className={styles.copyBtn} onClick={() => setFineTune(v => !v)}>
                細かく調整
              </button>

              {fineTune && (
                <div className={styles.fineTuneRow}>
                  <label htmlFor="subtitle-position-slider">字幕の上下位置</label>
                  <input
                    id="subtitle-position-slider"
                    aria-label="字幕の上下位置"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={position}
                    onChange={e => setPosition(Number(e.target.value))}
                  />
                </div>
              )}

              <button
                className={styles.genBtn}
                onClick={handleBurnIn}
                disabled={!allTranslated || stage === 'burning'}
              >
                {stage === 'burning' ? '焼き込み中...' : '次へ'}
              </button>
            </div>
          )}
        </>
      )}

      {stage === 'error' && errorMessage && (
        <p className={styles.error}>エラーが発生しました: {errorMessage}</p>
      )}
    </div>
  )
}
```

Add to `src/components/SubtitleWorkflow.module.css`:

```css
.previewWrapper {
  position: relative;
}

.fineTuneRow {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.fineTuneRow input[type='range'] {
  width: 100%;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/SubtitleWorkflow.tsx src/components/SubtitleWorkflow.module.css src/components/SubtitleWorkflow.test.tsx
git commit -m "$(cat <<'EOF'
feat: add subtitle fine-tune slider, drop in-step save button

Burn-in still runs exactly once (on the renamed 次へ button); position
adjustment now updates only the cheap CSS preview until then. Removes
the standalone save button now that FinalizePage owns the single
final save action.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Genre select in `MusicPicker`

**Files:**
- Modify: `src/components/MusicPicker.tsx`
- Modify: `src/components/MusicPicker.module.css`
- Test: `src/components/MusicPicker.test.tsx` (new)

**Interfaces:**
- Consumes: `MusicTrack`, `GENRE_LABELS`, `MusicGenre` from `src/data/musicTracks.ts` (unchanged).
- Produces: `MusicPickerProps.onSelect` type widens from `(id: string) => void` to `(id: string | null) => void` (called with `null` when the genre changes, to clear the previous selection).

- [ ] **Step 1: Write the failing test**

Create `src/components/MusicPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MusicPicker from './MusicPicker'
import { MusicTrack } from '../data/musicTracks'

const TRACKS: MusicTrack[] = [
  { id: 'lofi-1', title: 'Lofi One', genre: 'lofi', credit: 'a', file: 'music/lofi-1.mp3' },
  { id: 'pop-1', title: 'Pop One', genre: 'pop', credit: 'b', file: 'music/pop-1.mp3' },
]

describe('MusicPicker genre select', () => {
  it('defaults to the first genre with tracks and shows only its tracks', () => {
    render(
      <MusicPicker tracks={TRACKS} selectedId={null} onSelect={vi.fn()} volume={0.3} onVolumeChange={vi.fn()} />
    )
    expect(screen.getByText('Lofi One')).toBeInTheDocument()
    expect(screen.queryByText('Pop One')).not.toBeInTheDocument()
  })

  it('switches the visible track list when a different genre is selected', () => {
    render(
      <MusicPicker tracks={TRACKS} selectedId={null} onSelect={vi.fn()} volume={0.3} onVolumeChange={vi.fn()} />
    )
    fireEvent.change(screen.getByLabelText('ジャンル'), { target: { value: 'pop' } })
    expect(screen.getByText('Pop One')).toBeInTheDocument()
    expect(screen.queryByText('Lofi One')).not.toBeInTheDocument()
  })

  it('clears the current selection when the genre changes', () => {
    const onSelect = vi.fn()
    render(
      <MusicPicker tracks={TRACKS} selectedId="lofi-1" onSelect={onSelect} volume={0.3} onVolumeChange={vi.fn()} />
    )
    fireEvent.change(screen.getByLabelText('ジャンル'), { target: { value: 'pop' } })
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MusicPicker.test.tsx`
Expected: FAIL — no genre `<select>` with label "ジャンル" exists yet; all
tracks across genres currently render at once.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/components/MusicPicker.tsx` with:

```tsx
import { useRef, useState } from 'react'
import { MusicTrack, GENRE_LABELS, MusicGenre } from '../data/musicTracks'
import styles from './MusicPicker.module.css'

interface MusicPickerProps {
  tracks: MusicTrack[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  volume: number
  onVolumeChange: (volume: number) => void
}

const GENRE_ORDER: MusicGenre[] = ['lofi', 'pop', 'cinematic', 'corporate']

export default function MusicPicker({ tracks, selectedId, onSelect, volume, onVolumeChange }: MusicPickerProps) {
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [genre, setGenre] = useState<MusicGenre>(
    () => GENRE_ORDER.find(g => tracks.some(t => t.genre === g)) ?? GENRE_ORDER[0]
  )
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function handlePreview(track: MusicTrack) {
    if (previewingId === track.id) {
      audioRef.current?.pause()
      setPreviewingId(null)
      return
    }
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener('ended', () => setPreviewingId(null))
    }
    audioRef.current.src = `/${track.file}`
    audioRef.current.play()
    setPreviewingId(track.id)
  }

  function handleGenreChange(next: MusicGenre) {
    setGenre(next)
    onSelect(null)
  }

  const genreTracks = tracks.filter(t => t.genre === genre)

  return (
    <div className={styles.wrapper}>
      <label className={styles.genreRow}>
        <span className={styles.genreRowLabel}>ジャンル</span>
        <select
          aria-label="ジャンル"
          className={styles.genreSelect}
          value={genre}
          onChange={e => handleGenreChange(e.target.value as MusicGenre)}
        >
          {GENRE_ORDER.filter(g => tracks.some(t => t.genre === g)).map(g => (
            <option key={g} value={g}>
              {GENRE_LABELS[g]}
            </option>
          ))}
        </select>
      </label>

      {genreTracks.map(track => (
        <div
          key={track.id}
          className={`${styles.trackRow} ${selectedId === track.id ? styles.trackRowSelected : ''}`}
        >
          <button className={styles.trackTitle} onClick={() => onSelect(track.id)}>
            {track.title}
          </button>
          <button className={styles.previewBtn} onClick={() => handlePreview(track)}>
            {previewingId === track.id ? '■ 停止' : '▶ 試聴'}
          </button>
        </div>
      ))}

      <div className={styles.volumeRow}>
        <span className={styles.volumeLabel}>音量 {Math.round(volume * 100)}%</span>
        <input
          className={styles.volumeSlider}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  )
}
```

Replace `.genreGroup`/`.genreLabel` in `src/components/MusicPicker.module.css` with:

```css
.genreRow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.genreRowLabel {
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  white-space: nowrap;
}

.genreSelect {
  flex: 1;
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 0.85rem;
}
```

(Leave `.trackRow`, `.trackRowSelected`, `.trackTitle`, `.previewBtn`,
`.volumeRow`, `.volumeLabel`, `.volumeSlider` unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/MusicPicker.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/MusicPicker.tsx src/components/MusicPicker.module.css src/components/MusicPicker.test.tsx
git commit -m "$(cat <<'EOF'
feat: filter BGM track list by a genre select box

Replaces the all-genres-at-once grouped list (very tall with ~20
tracks) with one genre's tracks at a time, defaulting to the first
genre that has tracks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Auto-mix + skip flow in `MusicMixer`

**Files:**
- Modify: `src/components/MusicMixer.tsx`
- Modify: `src/components/MusicMixer.module.css`
- Test: `src/components/MusicMixer.test.tsx` (new)

**Interfaces:**
- Consumes: `MUSIC_TRACKS` (`src/data/musicTracks.ts`), `mixMusic(videoBlob, trackBlob, volume): Promise<Blob>` (`src/utils/mixMusic.ts`), `MusicPicker` (Task 4, `onSelect: (id: string | null) => void`).
- Produces: `MusicMixerProps` becomes `{ videoBlob: Blob; onMixed: (blob: Blob | null) => void; onNext: () => void }` (drops `filenameBase`). Calls `onMixed(blob)` after every successful auto-mix, `onMixed(null)` then `onNext()` when skipped, and `onNext()` once a mix has completed and the user advances.

- [ ] **Step 1: Write the failing test**

Create `src/components/MusicMixer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MusicMixer from './MusicMixer'
import * as mixModule from '../utils/mixMusic'
import { MUSIC_TRACKS } from '../data/musicTracks'

vi.mock('../utils/mixMusic')

const VIDEO_BLOB = new Blob(['v'], { type: 'video/mp4' })

// Real timers throughout (not vi.useFakeTimers): the component's debounce is
// a real setTimeout racing against testing-library's own waitFor polling,
// which also relies on real timers — mixing fake timers in here would
// require manually driving both clocks in lockstep. 300ms of real wall-clock
// wait per assertion below is cheap enough to just let happen.
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['track'], { type: 'audio/mpeg' })),
  }) as unknown as typeof fetch
  vi.mocked(mixModule.mixMusic).mockResolvedValue(new Blob(['mixed'], { type: 'video/mp4' }))
})

describe('MusicMixer auto-mix', () => {
  it('mixes automatically (debounced) once a track is selected, and reports the result', async () => {
    const onMixed = vi.fn()
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={vi.fn()} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1), { timeout: 1000 })
    await waitFor(() => expect(onMixed).toHaveBeenCalledWith(expect.any(Blob)))
  })

  it('only mixes once after several rapid volume changes (debounce)', async () => {
    const onMixed = vi.fn()
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={vi.fn()} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1), { timeout: 1000 })

    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.4' } })
    fireEvent.change(slider, { target: { value: '0.5' } })
    fireEvent.change(slider, { target: { value: '0.6' } })
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(2), { timeout: 1000 })
  })

  it('skips BGM entirely and advances immediately via BGMなしで進む', () => {
    const onMixed = vi.fn()
    const onNext = vi.fn()
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={onNext} />)

    fireEvent.click(screen.getByText('BGMなしで進む'))
    expect(onMixed).toHaveBeenCalledWith(null)
    expect(onNext).toHaveBeenCalled()
  })

  it('does not render a 合成する or 保存する button', () => {
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} />)
    expect(screen.queryByText('BGMを合成する')).not.toBeInTheDocument()
    expect(screen.queryByText('保存する')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MusicMixer.test.tsx`
Expected: FAIL — `MusicMixer` still requires `filenameBase`, still renders
"BGMを合成する"/"保存する", and has no "BGMなしで進む" button or `onMixed`/`onNext` props.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/components/MusicMixer.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { MUSIC_TRACKS } from '../data/musicTracks'
import { mixMusic } from '../utils/mixMusic'
import MusicPicker from './MusicPicker'
import styles from './MusicMixer.module.css'

interface MusicMixerProps {
  videoBlob: Blob
  onMixed: (blob: Blob | null) => void
  onNext: () => void
}

type Stage = 'idle' | 'mixing' | 'done' | 'error'

const DEBOUNCE_MS = 300

export default function MusicMixer({ videoBlob, onMixed, onNext }: MusicMixerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [volume, setVolume] = useState(0.3)
  const [stage, setStage] = useState<Stage>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [mixedUrl, setMixedUrl] = useState<string | null>(null)
  const mixedUrlRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (mixedUrlRef.current) URL.revokeObjectURL(mixedUrlRef.current)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runMix(selectedId, volume)
    }, DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, volume])

  if (MUSIC_TRACKS.length === 0) return null

  async function runMix(trackId: string, vol: number) {
    const track = MUSIC_TRACKS.find(t => t.id === trackId)
    if (!track) return

    setStage('mixing')
    setErrorMessage(null)
    try {
      const trackResponse = await fetch(`/${track.file}`)
      if (!trackResponse.ok) {
        throw new Error(`「${track.title}」の合成に失敗しました: ファイルの読み込みエラー`)
      }
      const trackBlob = await trackResponse.blob()
      const mixed = await mixMusic(videoBlob, trackBlob, vol)
      if (mixedUrlRef.current) URL.revokeObjectURL(mixedUrlRef.current)
      const url = URL.createObjectURL(mixed)
      mixedUrlRef.current = url
      setMixedUrl(url)
      setStage('done')
      onMixed(mixed)
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : `「${track.title}」の合成に失敗しました: ${String(err)}`
      )
      setStage('error')
    }
  }

  function handleSkip() {
    onMixed(null)
    onNext()
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.section}>
        <p className={styles.sectionTitle}>BGMを追加</p>
        <MusicPicker
          tracks={MUSIC_TRACKS}
          selectedId={selectedId}
          onSelect={setSelectedId}
          volume={volume}
          onVolumeChange={setVolume}
        />
        {stage === 'mixing' && <p className={styles.status}>プレビュー更新中...</p>}
        {stage === 'error' && errorMessage && <p className={styles.error}>{errorMessage}</p>}
      </div>

      {stage === 'done' && mixedUrl && (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>プレビュー</p>
          <video className={styles.preview} src={mixedUrl} controls playsInline />
        </div>
      )}

      <div className={styles.actions}>
        <button className={styles.skipBtn} onClick={handleSkip}>
          BGMなしで進む
        </button>
        <button className={styles.mixBtn} onClick={onNext} disabled={stage !== 'done'}>
          次へ
        </button>
      </div>
    </div>
  )
}
```

Add to `src/components/MusicMixer.module.css` (the existing `.mixBtn:disabled`
rule already covers the re-used `.mixBtn` class here):

```css
.status {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.actions .mixBtn {
  flex: 1;
}

.skipBtn {
  flex: 1;
  background: var(--surface2);
  color: var(--text);
  padding: 14px 16px;
  border-radius: 12px;
  font-size: 0.9rem;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/MusicMixer.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/MusicMixer.tsx src/components/MusicMixer.module.css src/components/MusicMixer.test.tsx
git commit -m "$(cat <<'EOF'
feat: auto-mix BGM preview on selection, drop 合成する button

Selecting a track or releasing the volume slider now triggers a
debounced real mix automatically; the mix result and a skip action are
reported to the parent instead of this component saving on its own.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `WizardSteps` progress indicator

**Files:**
- Create: `src/components/WizardSteps.tsx`
- Create: `src/components/WizardSteps.module.css`
- Test: `src/components/WizardSteps.test.tsx`

**Interfaces:**
- Produces: `export type WizardStepId = 'trim' | 'subtitle' | 'bgm' | 'export'`; `export default function WizardSteps(props: { current: WizardStepId; completed: WizardStepId[]; onSelect: (step: WizardStepId) => void }): JSX.Element`. Clicking a step whose id is in `completed` calls `onSelect(id)`; clicking the current or a not-yet-completed step does nothing.

- [ ] **Step 1: Write the failing test**

Create `src/components/WizardSteps.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WizardSteps from './WizardSteps'

describe('WizardSteps', () => {
  it('shows a checkmark on completed steps and highlights the current one', () => {
    render(<WizardSteps current="bgm" completed={['trim', 'subtitle']} onSelect={vi.fn()} />)
    const bgmStep = screen.getByText('BGM').closest('button')!
    expect(bgmStep).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('トリミング').closest('button')).toHaveTextContent('✓')
  })

  it('navigates back when a completed step is clicked', () => {
    const onSelect = vi.fn()
    render(<WizardSteps current="bgm" completed={['trim', 'subtitle']} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('字幕'))
    expect(onSelect).toHaveBeenCalledWith('subtitle')
  })

  it('does nothing when a not-yet-completed step is clicked', () => {
    const onSelect = vi.fn()
    render(<WizardSteps current="trim" completed={[]} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('書き出し'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/WizardSteps.test.tsx`
Expected: FAIL — module `./WizardSteps` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/WizardSteps.tsx`:

```tsx
import styles from './WizardSteps.module.css'

export type WizardStepId = 'trim' | 'subtitle' | 'bgm' | 'export'

interface WizardStepsProps {
  current: WizardStepId
  completed: WizardStepId[]
  onSelect: (step: WizardStepId) => void
}

const STEPS: { id: WizardStepId; label: string }[] = [
  { id: 'trim', label: 'トリミング' },
  { id: 'subtitle', label: '字幕' },
  { id: 'bgm', label: 'BGM' },
  { id: 'export', label: '書き出し' },
]

export default function WizardSteps({ current, completed, onSelect }: WizardStepsProps) {
  return (
    <div className={styles.wrapper}>
      {STEPS.map(step => {
        const isCurrent = step.id === current
        const isDone = completed.includes(step.id)
        return (
          <button
            key={step.id}
            type="button"
            className={`${styles.step} ${isCurrent ? styles.stepCurrent : ''} ${isDone ? styles.stepDone : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
            onClick={() => isDone && onSelect(step.id)}
            disabled={!isDone}
          >
            <span className={styles.dot}>{isDone ? '✓' : ''}</span>
            <span className={styles.label}>{step.label}</span>
          </button>
        )
      })}
    </div>
  )
}
```

Create `src/components/WizardSteps.module.css`:

```css
.wrapper {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
}

.step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: none;
  padding: 4px;
  opacity: 0.5;
}

.step:disabled {
  cursor: default;
}

.stepDone {
  opacity: 0.8;
}

.stepCurrent {
  opacity: 1;
}

.dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--surface2);
  color: #fff;
  font-size: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stepCurrent .dot,
.stepDone .dot {
  background: var(--accent);
}

.label {
  font-size: 0.7rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.stepCurrent .label {
  color: var(--text);
  font-weight: 700;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/WizardSteps.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/WizardSteps.tsx src/components/WizardSteps.module.css src/components/WizardSteps.test.tsx
git commit -m "$(cat <<'EOF'
feat: add wizard step progress indicator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Restructure `FinalizePage` into the 4-step wizard

**Files:**
- Modify: `src/pages/FinalizePage.tsx`
- Modify: `src/pages/FinalizePage.module.css`
- Test: `src/pages/FinalizePage.test.tsx` (new)

**Interfaces:**
- Consumes: `WizardSteps`/`WizardStepId` (Task 6); `SubtitleWorkflow` `{ combinedBlob, onBurned }` (Task 3); `MusicMixer` `{ videoBlob, onMixed, onNext }` (Task 5); `useScripts().getScript`, `listShotVideos`, `trimAndNormalizeShot`, `concatVideos`, `shareOrDownload` (all unchanged, pre-existing).
- Produces: the route's default export, unchanged signature (`FinalizePage(): JSX.Element`, no props — reads `id` from `useParams`).

- [ ] **Step 1: Write the failing test**

Create `src/pages/FinalizePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IDBFactory } from 'fake-indexeddb'
import FinalizePage from './FinalizePage'
import { Script } from '../types'
import { saveShotVideo } from '../utils/shotVideoStore'
import * as transcribeModule from '../utils/transcribeSpeech'
import * as burnModule from '../utils/burnSubtitles'
import * as mixModule from '../utils/mixMusic'

vi.mock('../utils/transcribeSpeech')
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

const SHOT_1 = '11111111-1111-1111-1111-111111111111'

function seedScript(): Script {
  const script: Script = {
    id: 'script-1',
    title: 'テスト動画',
    shots: [{ id: SHOT_1, text: 'ショット1' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
  return script
}

function renderFinalizePage(scriptId: string) {
  render(
    <MemoryRouter initialEntries={[`/scripts/${scriptId}/finalize`]}>
      <Routes>
        <Route path="/scripts/:id/finalize" element={<FinalizePage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  vi.clearAllMocks()
  const script = seedScript()
  await saveShotVideo(script.id, SHOT_1, new Blob(['shot'], { type: 'video/mp4' }))

  vi.mocked(transcribeModule.transcribeSpeech).mockResolvedValue([
    { id: 'c1', start: 0, end: 2, en: 'Hello', ja: null },
  ])
  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['burned'], { type: 'video/mp4' }))
  vi.mocked(mixModule.mixMusic).mockResolvedValue(new Blob(['mixed'], { type: 'video/mp4' }))
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['track'], { type: 'audio/mpeg' })),
  }) as unknown as typeof fetch
})

describe('FinalizePage wizard', () => {
  it('walks trim → combine → subtitle → BGM skip → export, with a single save button at the end', async () => {
    renderFinalizePage('script-1')

    // Step 1: trim/combine
    await screen.findByText('1. ショット1')
    // jsdom never loads real media, so ShotTrimmer's <video onLoadedMetadata>
    // never fires on its own; without a known duration, canCombine stays
    // false and 結合する stays disabled. Stub the one shot's duration and
    // fire the event manually, the same thing a real video load would do.
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    // Step 2: subtitle — generate, translate, advance without changing position
    fireEvent.click(await screen.findByText('🎤 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))

    // Step 3: BGM — skip
    fireEvent.click(await screen.findByText('BGMなしで進む'))

    // Step 4: export — exactly one save button, wired to the burned (BGM-less) blob
    expect(await screen.findByText('保存する')).toBeInTheDocument()
    expect(screen.queryAllByText('保存する')).toHaveLength(1)
  })

  it('shows the wizard progress indicator with 4 steps', async () => {
    renderFinalizePage('script-1')
    await screen.findByText('1. ショット1')
    expect(screen.getByText('トリミング')).toBeInTheDocument()
    expect(screen.getByText('字幕')).toBeInTheDocument()
    expect(screen.getByText('BGM')).toBeInTheDocument()
    expect(screen.getByText('書き出し')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/FinalizePage.test.tsx`
Expected: FAIL — the page still renders every section on one long scroll
with 3 separate save buttons and no `WizardSteps`/"次へ" navigation.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/pages/FinalizePage.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import { trimAndNormalizeShot } from '../utils/trimAndNormalizeShot'
import { concatVideos } from '../utils/concatVideos'
import { shareOrDownload } from '../utils/shareOrDownload'
import ShotTrimmer from '../components/ShotTrimmer'
import SubtitleWorkflow from '../components/SubtitleWorkflow'
import MusicMixer from '../components/MusicMixer'
import WizardSteps, { WizardStepId } from '../components/WizardSteps'
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

const STEP_ORDER: WizardStepId[] = ['trim', 'subtitle', 'bgm', 'export']

export default function FinalizePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript } = useScripts()
  const script = id ? getScript(id) : undefined

  const [entries, setEntries] = useState<ShotEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [combineState, setCombineState] = useState<CombineState>('idle')
  const [combineError, setCombineError] = useState<string | null>(null)
  const [combinedUrl, setCombinedUrl] = useState<string | null>(null)
  const [combinedBlob, setCombinedBlob] = useState<Blob | null>(null)
  const [burnedBlob, setBurnedBlob] = useState<Blob | null>(null)
  const [mixedBlob, setMixedBlob] = useState<Blob | null>(null)
  const [step, setStep] = useState<WizardStepId>('trim')
  const [completedSteps, setCompletedSteps] = useState<WizardStepId[]>([])
  const urlsRef = useRef<string[]>([])
  const combinedUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!script) return
    let cancelled = false

    listShotVideos(script.id).then(stored => {
      if (cancelled) return
      const byShotId = new Map(stored.map(v => [v.shotId, v.blob]))
      const next = script.shots.map(shot => {
        const blob = byShotId.get(shot.id) ?? null
        const url = blob ? URL.createObjectURL(blob) : null
        if (url) urlsRef.current.push(url)
        return { shotId: shot.id, text: shot.text, blob, url, duration: 0, trimStart: 0, trimEnd: 0 }
      })
      setEntries(next)
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      console.error('Failed to load stored shot videos', err)
      setLoadError('動画の読み込みに失敗しました。ページを再読み込みしてください。')
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id])

  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  useEffect(() => {
    return () => {
      if (combinedUrlRef.current) URL.revokeObjectURL(combinedUrlRef.current)
    }
  }, [])

  function updateEntry(shotId: string, changes: Partial<ShotEntry>) {
    setEntries(prev => prev.map(e => (e.shotId === shotId ? { ...e, ...changes } : e)))
  }

  function markStepDone(done: WizardStepId, next: WizardStepId) {
    setCompletedSteps(prev => (prev.includes(done) ? prev : [...prev, done]))
    setStep(next)
  }

  function goToStep(target: WizardStepId) {
    // Going back to an earlier step invalidates every step after it, since
    // its input may change (e.g. re-combining after adjusting a trim).
    const targetIndex = STEP_ORDER.indexOf(target)
    setCompletedSteps(prev => prev.filter(s => STEP_ORDER.indexOf(s) < targetIndex))
    if (STEP_ORDER.indexOf('subtitle') >= targetIndex) setBurnedBlob(null)
    if (STEP_ORDER.indexOf('bgm') >= targetIndex) setMixedBlob(null)
    setStep(target)
  }

  const availableEntries = entries.filter(e => e.blob)
  const canCombine = availableEntries.length > 0 && availableEntries.every(e => e.duration > 0)
  const finalBlob = mixedBlob ?? burnedBlob ?? combinedBlob

  async function handleCombine() {
    setCombineState('combining')
    setCombineError(null)
    // Re-combining invalidates any later step's output. `completedSteps`
    // never contains 'subtitle'/'bgm' while sitting on 'trim' (the only way
    // back here is goToStep, which already truncates completedSteps), so
    // clearing the blobs is sufficient — no completedSteps update needed.
    setBurnedBlob(null)
    setMixedBlob(null)
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
      setCombineState('done')
    } catch (err) {
      setCombineError(err instanceof Error ? err.message : String(err))
      setCombineState('error')
    }
  }

  async function handleSaveFinal() {
    if (!finalBlob || !script) return
    await shareOrDownload(finalBlob, `${script.title}-final`)
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
        <button className={styles.backBtn} onClick={() => navigate(`/scripts/${script.id}/shots`)}>
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>動画を仕上げる</h1>
      </div>

      {loading ? (
        <p className={styles.missing}>読み込み中...</p>
      ) : loadError ? (
        <p className={styles.missing}>{loadError}</p>
      ) : (
        <>
          <WizardSteps current={step} completed={completedSteps} onSelect={goToStep} />

          {step === 'trim' && (
            <div className={styles.stepBody}>
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
                          onDurationKnown={duration => updateEntry(entry.shotId, { duration, trimEnd: duration })}
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
                  <button
                    className={styles.finalizeBtn}
                    onClick={() => markStepDone('trim', 'subtitle')}
                  >
                    次へ
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'subtitle' && combinedBlob && (
            <div className={styles.stepBody}>
              <SubtitleWorkflow
                key={combinedUrl}
                combinedBlob={combinedBlob}
                onBurned={burned => {
                  setBurnedBlob(burned)
                  markStepDone('subtitle', 'bgm')
                }}
              />
            </div>
          )}

          {step === 'bgm' && finalBlob && (
            <div className={styles.stepBody}>
              <MusicMixer
                videoBlob={finalBlob}
                onMixed={setMixedBlob}
                onNext={() => markStepDone('bgm', 'export')}
              />
            </div>
          )}

          {step === 'export' && finalBlob && (
            <div className={styles.stepBody}>
              <p className={styles.shotEntryText}>完成した動画</p>
              <video className={styles.preview} src={URL.createObjectURL(finalBlob)} controls playsInline />
              <button className={styles.finalizeBtn} onClick={handleSaveFinal}>
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

Add to `src/pages/FinalizePage.module.css`:

```css
.stepBody {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/FinalizePage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — all existing suites (`RecordPage.test.tsx`,
`burnSubtitles.test.ts`, `mixMusic.test.ts`, `subtitleCues.test.ts`, plus
every test added in Tasks 1–7) pass with no failures.

- [ ] **Step 6: Commit**

```bash
git add src/pages/FinalizePage.tsx src/pages/FinalizePage.module.css src/pages/FinalizePage.test.tsx
git commit -m "$(cat <<'EOF'
feat: restructure FinalizePage into a 4-step wizard

Trim & Combine, Subtitle, BGM, and Export now render one at a time
behind a progress indicator, with a single save action at the final
Export step instead of three separate mid-page save buttons.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Type-check and build verification

**Files:** none (verification only)

- [ ] **Step 1: Run the TypeScript project build (not just `--noEmit`)**

Run: `npx tsc -b`
Expected: no errors. (Per this project's own established convention —
`tsc --noEmit -p .` silently checks nothing here — always use `tsc -b`.)

- [ ] **Step 2: Run the full test suite once more**

Run: `npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 3: Run lint**

Run: `npx eslint .`
Expected: no errors. Fix any reported issues (e.g. unused
`filenameBase`/`onBurned` leftovers, unused CSS-module class warnings are
not lint-checked so ignore those) and re-run until clean.

- [ ] **Step 4: Commit if Step 3 required fixes**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: address lint findings from finalize wizard refactor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(Skip this commit if lint was already clean in Step 3.)

---

## Self-Review Notes

- **Spec coverage:** wizard shell + progress indicator (Task 6, 7), save
  consolidated to one button (Task 7), genre select filtering BGM tracks
  (Task 4), auto-preview mix replacing the "合成する" button (Task 5),
  subtitle position preset + fine-tune slider with cheap CSS preview
  (Tasks 1–3) — every section of the design doc has a corresponding task.
- **Type consistency checked:** `MusicPickerProps.onSelect` widened to
  `(id: string | null) => void` in Task 4 and threaded through unchanged
  in Task 5 (`setSelectedId` is already `Dispatch<SetStateAction<string | null>>`,
  so it satisfies the widened type without further changes).
  `SubtitlePosition` changes from Task 1 propagate into Task 3's presets
  and Task 2's `SubtitleOverlayPreview` prop type consistently as `number`.
  `WizardStepId` defined once in Task 6, imported (not redefined) in Task 7.
- **No placeholders:** every step includes complete, runnable code; no
  "TODO"/"similar to Task N" shortcuts.
