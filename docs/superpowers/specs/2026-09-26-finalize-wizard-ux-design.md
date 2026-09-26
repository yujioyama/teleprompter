# Finalize Screen UX Revision (Wizard + Save Consolidation + BGM/Subtitle Controls)

**Date:** 2026-09-26
**Status:** Approved (brainstorming)
**Supersedes (partially):** `2026-09-23-video-finalize-design.md` — that doc's
pipeline (combine → captions → translate → position/BGM → export) and
processing utilities (`burnSubtitles`, `mixMusic`, `concatVideos`, etc.) are
unchanged and still authoritative for *how* each step processes video. This
doc changes how those steps are *presented and sequenced* in the UI, and
extends subtitle positioning and BGM selection.

## Problem

The current `FinalizePage` renders every step (shot trimming, combine,
subtitles, BGM) in one long vertically-scrolling page, with each step's
result immediately followed by its own "保存する" button (three save buttons
total: combined video, subtitled video, BGM-mixed video). User feedback:

1. The page is too long / unclear what to do in what order.
2. Multiple "保存する" buttons appear and it's unclear which one is final.
3. The BGM track list shows all ~20 tracks across all genres at once
   (very tall); there's no way to filter to one genre.
4. The "BGMを合成する" button is visible immediately, before any track is even
   selected, and its effect (does it apply live? when?) is unclear.
5. Subtitle position only offers 3 fixed presets; no fine-grained control.

## Approach

Restructure `FinalizePage` into a 4-step wizard: **Trim & Combine → Subtitle
→ BGM → Export**. Only step 4 (Export) has a save action. Steps 2 and 3 show
live, cheap previews as the user adjusts settings, and defer the actual
expensive FFmpeg operation (subtitle burn-in) or run a cheap one eagerly
(BGM mix) as appropriate — see "Processing cost tradeoffs" below.

### Why a wizard (not accordion/tabs)

User chose the wizard explicitly: one step visible at a time removes the
"how far do I need to scroll / what's next" ambiguity that prompted this
change, at the cost of more UI state management than an accordion would
need. Target device is primarily mobile (narrow single-column layout).

## Architecture

### New/changed files

| File | Change |
|------|--------|
| `src/pages/FinalizePage.tsx` | Restructured as wizard shell: owns `currentStep`, per-step completion flags, and all intermediate blobs (`combinedBlob`, `burnedBlob`, `mixedBlob`). Renders `WizardSteps` + the active step's component. `handleSave` is the only save action, at step 4. |
| `src/components/WizardSteps.tsx` + `.module.css` | **New.** Progress indicator: 4 labeled dots ("トリミング" / "字幕" / "BGM" / "書き出し"), current step highlighted, completed steps checkmarked. Not clickable directly forward (must complete steps in order) but clicking a completed step navigates back to it. |
| `src/components/SubtitleWorkflow.tsx` | Add fine-tune toggle + slider (see below). Burn-in (`burnSubtitles`) now runs once, triggered by the step's "次へ" action, not by a "保存する" button. Drop `handleSaveBurned`/save button. |
| `src/utils/subtitlePosition.ts` | `SubtitlePosition` changes from a 3-value string union to `number` (0–100, percent of video height for the overlay's vertical anchor). `subtitleY(percent, videoHeight, overlayHeight)` becomes a single linear formula. The 3 preset buttons set `position` to fixed constants (`8`, a computed center value, `78`) — see "Subtitle position migration" below. |
| `src/components/MusicMixer.tsx` | Drop "BGMを合成する" button and `handleSave`. Runs `mixMusic` automatically (debounced) on track/volume change. Adds "BGMなしで進む" (skip) affordance. Owns the "次へ" transition to step 4. |
| `src/components/MusicPicker.tsx` | Add a genre `<select>` above the track list; only the selected genre's tracks render. Defaults to `'lofi'` (first in `GENRE_ORDER`, effectively "most popular" per existing ordering). |
| `src/components/SubtitleOverlayPreview.tsx` | **New.** Lightweight DOM/CSS overlay (not canvas/ffmpeg) rendered on top of the `<video>` preview element, showing cue text at the currently-selected vertical percent, for instant feedback while adjusting position — before the real burn-in runs. |

### FinalizePage state shape

```ts
type WizardStep = 'trim' | 'subtitle' | 'bgm' | 'export'

// existing entries/combine state unchanged; added:
const [step, setStep] = useState<WizardStep>('trim')
const [burnedBlob, setBurnedBlob] = useState<Blob | null>(null)   // from subtitle step
const [mixedBlob, setMixedBlob] = useState<Blob | null>(null)     // from BGM step (null if skipped)

// what step 4 actually saves:
const finalBlob = mixedBlob ?? burnedBlob ?? combinedBlob
```

Going back to an earlier step and changing it (e.g. re-trimming a shot,
which re-runs combine) invalidates every later step's blob, same as today's
existing invalidation comment in `handleCombine` — this behavior is
preserved, just now also resets `step` back to the step whose input changed
if the user was ahead of it.

### Processing cost tradeoffs

This is the key technical constraint driving the subtitle vs. BGM UX
difference:

- **`burnSubtitles`** (ffmpeg): full video re-encode (`libx264`, per-cue PNG
  overlay filtergraph). Cost scales with video length and cue count —
  seconds to tens of seconds. **Not** something to re-run on every slider
  tick.
- **`mixMusic`** (ffmpeg): video is stream-copied, only audio is re-encoded
  and mixed. Much cheaper (roughly proportional to audio duration only, no
  video re-encode). Cheap enough to re-run per track/volume change, given a
  debounce.

Consequently:
- **Subtitle position**: adjustments (3 buttons or fine-tune slider) update
  only a lightweight CSS overlay (`SubtitleOverlayPreview`) over the raw
  combined video for instant feedback. The real `burnSubtitles` call happens
  exactly once, when the user proceeds ("次へ") from the subtitle step.
- **BGM**: track selection or volume release triggers a real `mixMusic` call
  automatically (debounced ~300ms so a volume drag doesn't fire on every
  intermediate value), updating the actual preview `<video>` with real mixed
  audio. No separate "合成する" action exists.

### Subtitle step details

- Default UI: unchanged 3 buttons (上部/中央/下部), now setting `position`
  (a percent number) to preset constants instead of a string enum value.
- A "細かく調整" toggle reveals a `<input type="range" min={0} max={100}>`
  bound to the same `position` state, letting the user pick any percent.
  Toggling it off does not reset `position` — it's still whichever value was
  last set (by preset or slider).
- `SubtitleOverlayPreview` renders cue text (current cue based on video
  `currentTime`) as an absolutely-positioned `<div>` over the `<video>`,
  `top: ${position}%`, styled to visually approximate the real burned-in
  box (semi-transparent rounded background, bold EN + smaller JA line) so
  the preview isn't misleading.
- "次へ" is disabled until `allTranslated` (same gate as today) and runs
  `burnSubtitles(combinedBlob, cues, position)` once, storing the result as
  `burnedBlob`, then advances to the BGM step.

#### Subtitle position migration

`subtitleY` signature changes:

```ts
// Before
export type SubtitlePosition = 'top' | 'center' | 'bottom'
export function subtitleY(position: SubtitlePosition, videoHeight: number, overlayHeight: number): number

// After
export type SubtitlePosition = number // 0-100, percent from top
export function subtitleY(position: SubtitlePosition, videoHeight: number, overlayHeight: number): number {
  return Math.round((videoHeight * position) / 100 - overlayHeight / 2)
}
```

The 3 preset buttons map to percent values chosen to reproduce today's exact
pixel results at the reference 1920px video height (`OVERLAY_HEIGHT = 220`):
`top → 12` (≈ old `0.08 * 1920 = 153.6px` from formula above), `center → 50`,
`bottom → 72` (≈ old `0.78 * 1920 - 220 = 1277.6px`). Exact constants are
computed and unit-tested against the old formula's output at implementation
time so existing visual behavior for the 3 presets doesn't shift.

### BGM step details

- `MusicPicker` gets a new `<select>` (genre) above the existing track rows;
  `GENRE_ORDER` supplies its options. Changing genre re-filters the visible
  track list to that genre only; does not clear `selectedId` if the
  previously-selected track happens to share the new genre (it won't, in
  practice, since switching genre is exactly to browse a different set —
  clearing `selectedId` on genre change is the simpler, correct behavior).
- Track select or volume-slider `onChange` (debounced) triggers `handleMix`
  automatically. A small inline status replaces the old button: "プレビュー
  更新中..." while mixing, nothing once settled.
- "BGMなしで進む" button always visible in this step; skips straight to
  Export with `mixedBlob` left `null` (so `finalBlob` falls back to
  `burnedBlob`).
- Once a mix completes, "次へ" becomes available (or is implicit — skipping
  is the same action, just without a mix).

### Export step

- Shows `finalBlob` in a `<video>` preview.
- One "保存する" button → existing `shareOrDownload(finalBlob, ...)`.
- No further per-step buttons exist by this point; this is the only save
  action in the whole page.

## Error handling

Unchanged from the existing design doc's error handling section (FFmpeg
failures surface inline with the pre-failure video still available; Japanese
paste mismatch blocks with an inline message). Added:

- **Auto-mix failure** (BGM step): shown inline same as before, but since
  there's no explicit trigger button, the error must be clearly tied to the
  currently-selected track (e.g. "「Lofi Sunny Cafe」の合成に失敗しました") so
  the user knows what to retry (reselecting the track, or a different one).

## Out of scope

- Draggable subtitle overlay (direct manipulation on the video) — slider-only
  fine-tuning, per user's explicit choice.
- Horizontal subtitle position adjustment (vertical only, matching today).
- Persisting wizard step/position across a page reload (in-memory state
  only, same as today).
- Changing the underlying `burnSubtitles`/`mixMusic`/`concatVideos` FFmpeg
  pipelines themselves — this doc only changes when/how they're invoked from
  the UI.
