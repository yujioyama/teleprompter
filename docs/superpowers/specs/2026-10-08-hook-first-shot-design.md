# Hook on the First Shot

**Date:** 2026-10-08
**Status:** Approved (brainstorming)

## Problem

TikTok analytics for 13 videos show most viewers leaving at 0:01–0:02 on
every video, and average watch time sits at 6–14 seconds no matter how long
the video is. Whether someone keeps watching is decided in the first one or
two seconds, but the first shot currently looks like every other shot: the
same small subtitle at the bottom, a still frame, and — with subtitles made
「話した音声から」 — often no text at all for the first 0.3 s.

## Goal

Make the first shot stop the thumb. From the 仕上げる screen:

1. **Hook subtitle style** — the first shot's cues render larger, with a
   darker band, at their own position (default: center).
2. **Text from the first frame** — the first hook cue shows from 0.0 s, so
   the feed's first frame and the cover already carry big text.
3. **Keyword emphasis** — `*word*` in subtitle text renders that word in
   yellow (`#FFD60A`), in normal and hook cues alike.
4. **Hook headline** (optional) — a short line of on-screen-only text shown
   above the hook subtitle for the first shot only.
5. **First-shot lead-in** — auto-trim leaves almost no silence before the
   first shot's speech (default 0.05 s).
6. **Punch-in** — the first shot's picture slowly zooms 1.0 → 1.08; the
   subtitles on top don't zoom.
7. **Settings** — 1, 4 and 6 can be switched on/off and the hook position
   changed in the subtitle step; they persist in `useSettings`.

Both burn paths get all of this: per-shot (`burnShotSubtitles` →
`normalizeShotWebCodecs`) and the whole-joined-video fallback
(`burnSubtitles` → WebCodecs, or ffmpeg.wasm).

## Non-goals

- Hook treatment for any shot other than the first.
- Animated text (pop-in, typewriter) or per-word timing.
- Colors other than the one highlight yellow, or emphasis styles other than
  color (no bold/size change on emphasized words).
- A first-shot lead-in field per script; the per-shot override that already
  exists covers exceptions.

## Definitions (shared by preview and both burn paths)

- **First shot** — the first clip of the 結合 (`combinedClips[0]`), i.e. the
  first script shot that has a recorded take. Its length is
  **D** = `end - start` of that clip.
- **Hook cue** — a cue whose `start < D` on the joined video's timeline.
  This is decided **once, on the joined timeline, before cues are split per
  shot**. So a Whisper cue that straddles shots 0 and 1 is a hook cue in both
  shots' encodes (no style change mid-cue), and the per-shot path agrees
  exactly with the whole-video path's rule ("cues starting within the first
  shot"). With 「話した音声から」 the first shot usually holds several short
  cues; all of them are hook cues.
- A cue with `ja === null` is still not burned, hook or not (unchanged).

## Design

### Styled cues — `src/utils/subtitleHook.ts` (new)

Pure, shared by the preview, the per-shot path and the whole-video path:

```ts
export type CueVariant = 'normal' | 'hook'
export type StyledCue = SubtitleCue & { variant: CueVariant }

export interface HookOptions {
  /** 1: hook subtitle style (and 2: first hook cue from 0.0 s). */
  style: boolean
  /** 0-100, where hook cues are centered. */
  position: SubtitlePosition
  /** 4: already resolved — '' when the toggle is off or the field is empty. */
  headline: string
  /** 6: zoom the first shot's picture. */
  punchIn: boolean
}

export function styleCues(cues: SubtitleCue[], firstShotDuration: number, hookStyle: boolean): StyledCue[]
export function hookOptionsOf(settings: AppSettings, headline: string): HookOptions
export function punchInScale(t: number, duration: number): number // 1 + 0.08·min(t/D, 1) for t < D, else 1
export const PUNCH_IN_ZOOM = 0.08
```

`styleCues` marks every cue with `start < D` as `'hook'` when `hookStyle` is
on (all `'normal'` otherwise), and moves the **earliest** hook cue's `start`
to 0 (item 2). Since hook cues are the earliest cues, nothing precedes it.
Script-made cues already start at 0, so only Whisper cues change. The 0 s
start is part of the hook style: off → cues keep their own timing.

The saved `SubtitleCue` shape is unchanged; variants are derived at render
time. `cuesForShot` becomes generic (`<T extends SubtitleCue>`) so it keeps
`variant` when splitting.

### 1. Hook subtitle layout — `src/utils/subtitleLayout.ts`

```ts
export const HOOK_EN_STYLE = { weight: 'bold',   maxPx: 100, minPx: 72, maxLines: 3, lineHeight: 1.2 }
export const HOOK_JA_STYLE = { weight: 'normal', maxPx: 75,  minPx: 57, maxLines: 3, lineHeight: 1.4 }
export const SUBTITLE_BOX_OPACITY = { normal: 0.55, hook: 0.8 }

export function layoutCue(cue, measure, variant: CueVariant = 'normal'): CueLayout
export function textStylesFor(variant: CueVariant): { en: TextStyle; ja: TextStyle }
```

Box margins, padding and radius stay the same; only fonts and band opacity
change. `renderCueImage(cue, variant)` draws with the variant's fonts and
opacity. `SubtitleOverlayPreview` lays the active cue out with the same
`layoutCue(cue, measure, variant)` and picks its band opacity from
`SUBTITLE_BOX_OPACITY`, so preview and burn-in match.

A hook cue is centered at `hook.position` (default
`SUBTITLE_POSITION_CENTER`); normal cues stay at the subtitle position.
Both are clamped on screen as today.

### 2. First frame

Covered by `styleCues`. Because every path (preview, per-shot, whole-video)
goes through it, the 0 s start shows in the preview and in both burns.

### 3. Keyword emphasis — `src/utils/subtitleEmphasis.ts` (new)

```ts
export interface Emphasis { text: string; emphasized: boolean[] } // one flag per UTF-16 unit of text
export interface Run { text: string; emphasized: boolean }
export const EMPHASIS_COLOR = '#FFD60A'

export function parseEmphasis(raw: string): Emphasis
export function emphasisRuns(lines: string[], emphasis: Emphasis): Run[][]
export function stripEmphasis(raw: string): string
```

- **Markers:** `*…*` pairs, matched by `/\*([^\s*](?:[^*\n]*[^\s*])?)\*/g` (no lookbehind: it throws on Safari < 16.4). The
  content must not start or end with whitespace, so `5 * 3 * 2` stays
  literal. Unpaired `*` stay as literal characters.
- **Wrapping is untouched:** `layoutBlock` passes `parseEmphasis(raw).text`
  (markers removed) to `wrapText`, so line breaks are measured on exactly
  what is drawn.
- **Back to runs:** `wrapText`'s lines are the plain text with whitespace
  collapsed and split, so walking each line against the plain text (skipping
  whitespace in the plain text that the line doesn't have) recovers each
  drawn character's flag. `emphasisRuns` groups consecutive characters with
  the same flag into runs.
- `TextBlockLayout` gains `runs: Run[][]` (one array per line; `lines` stays
  for tests and measuring).
- **Drawing:** the canvas measures a line's runs, starts at
  `center - total/2` with `textAlign = 'left'`, and `fillText`s each run in
  its color (base color, or `EMPHASIS_COLOR`). The preview renders each run
  as a `<span>`, emphasized ones with a class colored `#FFD60A`.
- Applies to `en`, `ja` and the headline, in normal and hook cues alike. (If
  Claude ever carries `*` over into a translation, it highlights instead of
  showing up literally.)
- `buildClaudePrompt` sends `stripEmphasis(cue.en)`, so markers don't leak
  into the translation request.
- `SubtitleEditor` keeps showing the raw text with its asterisks, plus a
  hint under the list: 「*で囲んだ語は黄色で強調されます」.

### 4. Hook headline

- **Text** is per video: `SubtitleState.hookHeadline: string` (default `''`),
  saved with the rest of the subtitle work in `SavedSubtitles` (older saved
  records without it load as `''`). A re-combine in the same session keeps
  the headline (it doesn't depend on timing), even though it resets the
  cues.
- **On/off** is a setting (`hookHeadlineEnabled`, default on). Off hides the
  input and draws nothing. `hookOptionsOf` resolves both into
  `HookOptions.headline` (`''` = nothing to draw).
- **Look:** `HEADLINE_STYLE = { bold, maxPx 72, minPx 56, maxLines 2,
  lineHeight 1.2 }`, white text with emphasis support, on a dark band
  (opacity 0.8) **shrink-wrapped to the text width** (widest line + box
  padding) and centered. This keeps it visually distinct from the
  full-width subtitle band. `layoutHeadline(text, measure)` returns its
  lines, runs, box width and height; `renderHeadlineImage(text)` draws it.
- **Time:** `[0, D)`.
- **Vertical position** — `headlineY(boxTops, headlineHeight, hookPosition)`:
  - The headline's bottom sits `SUBTITLE_BLOCK_GAP * 2` (28 px) above the
    **topmost** box among the first shot's burned cues (`boxTops` = the
    clamped `y` of each rendered cue overlay starting before D). It stays put
    while those cues change.
  - With no such cue, it is centered at `hookPosition`.
  - It is clamped to `y ≥ 0`.

  With the hook style off, the first shot's cues sit at the normal position
  and the headline goes above them.
- Shown even when the first shot's cues have no `ja`.
- **Preview:** `SubtitleOverlayPreview` computes the same `headlineY` from
  `layoutCue` heights of the first shot's translated cues and places the
  headline box with `top: y / 1920 * 100%` (no translate), shown while
  `currentTime < D`.

### 5. First-shot lead-in

- `AppSettings.firstShotPaddingStart: number`, default `0.05`.
- `resolveShotTrimSettings(shot, global, isFirstShot = false)`: for the
  first shot, `trimPaddingStart = shot.trimPaddingStart ??
  global.firstShotPaddingStart`. A shot's own override still wins, and the
  end padding is unaffected.
- `FinalizePage`'s load computes the first shot as the first script shot
  with a stored take, and passes `isFirstShot` for it. Stored speech regions
  are padding-independent (`speechBoundsFor`), so the new padding applies
  without re-analysis. Hand-set trims saved in `finalizeProgressStore` still
  take precedence, as today.
- Settings page → 自動トリミング: a new slider 「最初のショットの前に残す時間」
  (0–0.5 s, step 0.05, shown as `0.05秒`), disabled when auto-trim is off.

### 6. Punch-in

- `createOverlayProcess(overlays, options?: { punchInUntil?: number })`. For
  frames with `t < punchInUntil` it draws the sample scaled by
  `punchInScale(t, punchInUntil)` about the frame center
  (`sample.draw(ctx, -(W·(s-1))/2, -(H·(s-1))/2, W·s, H·s)`), then composites
  the active overlays at their normal size on top. Frames outside the
  punch-in window with no active cue still pass through untouched.
  Mediabunny calls `process` after the resize to 1080×1920, so `W`/`H` are
  output dimensions.
- **Per-shot path:** only shot 0's encode gets `punchInUntil = D` (its own
  timeline starts at 0). `normalizeShotWebCodecs` installs `process` when
  there are overlays **or** a punch-in.
- **Whole-video WebCodecs:** `burnSubtitlesWebCodecs` passes
  `punchInUntil = D` (the joined timeline also starts with the first shot).
- **Whole-video ffmpeg.wasm:** a `zoompan` stage feeds the overlay chain:
  `[0:v]zoompan=z='if(lt(in/30,D),1+0.08*(in/30)/D,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30[base]`,
  with the overlays chained from `[base]` instead of `[0:v]`. The joined
  video is normalized to 30 fps, so `in/30` is the frame time. `zoompan`
  rounds its crop to whole pixels, so the zoom may judder slightly; this is
  accepted on this last-resort path.
- **Preview:** the subtitle step's `<video>` gets
  `transform: scale(punchInScale(previewTime, D))` (with
  `transform-origin: center`, and the wrapper clipping with
  `overflow: hidden`). The subtitle overlay is a sibling, so it doesn't
  scale.

### 7. Settings and data flow

`AppSettings` gains:

| field | default | used by |
|---|---|---|
| `hookStyleEnabled` | `true` | 1, 2 |
| `hookPosition` | `SUBTITLE_POSITION_CENTER` | 1, 4 |
| `hookHeadlineEnabled` | `true` | 4 |
| `punchInEnabled` | `true` | 6 |
| `firstShotPaddingStart` | `0.05` | 5 |

**Subtitle step UI** (in the プレビュー section, under 字幕の位置): a block
「最初のショット（フック）」 containing:
- **フック字幕** toggle.
- **フック字幕の位置**: the same 上部/中央/下部 presets, plus a slider shown
  under the existing 細かく調整 toggle. Disabled when フック字幕 is off.
- **フック見出し** toggle, and a text input (placeholder e.g.
  `'carry a torch' ≠ romantic?`) while it's on.
- **パンチイン** toggle.

**One settings instance.** `useSettings` keeps its own React state per call,
so a second call inside `SubtitleWorkflow` would not update the copy
`FinalizePage` burns with. `FinalizePage` therefore takes
`[settings, updateSettings]` and passes `SubtitleWorkflow` the four hook
values plus an `onHookSettingsChange(patch)` that calls `updateSettings`.
`FinalizePage` builds `HookOptions` with
`hookOptionsOf(settings, subtitleState.hookHeadline)` and uses it in the
`burn` callback and the background-burn effect.
`SubtitleWorkflow` gets the first shot's length from `shotCueInputs[0].duration`
(the same clip as `combinedClips[0]`) for its preview.

**Burn API changes**

```ts
// burnSubtitles.ts
interface SubtitleLook {
  position: SubtitlePosition
  hook: HookOptions
  /**
   * D, when this video starts with the first shot (the whole joined video,
   * or shot 0's own clip): the headline shows and the punch-in runs over
   * [0, D). null for every other shot's clip.
   */
  firstShotDuration: number | null
}
renderSubtitleOverlays(cues: StyledCue[], look: SubtitleLook): Promise<SubtitleOverlay[]>
burnSubtitles(videoBlob, cues: SubtitleCue[], look: SubtitleLook, onProgress?, signal?)        // styles cues itself
burnShotSubtitles(blob, start, end, cues: StyledCue[], look: SubtitleLook, onProgress?, signal?)

// shotEncoding.ts
burnRequest(clip, cues: StyledCue[], look: SubtitleLook): EncodeRequest
shotBurnRequests(clips, cues: SubtitleCue[], position, hook): EncodeRequest[]
burnSubtitlesByShot(cache, clips, combinedBlob, cues, position, hook, onProgress?, signal?)
```

- `renderSubtitleOverlays` places hook cues at `hook.position` and normal
  ones at `position`. When `firstShotDuration` is set and the headline is
  non-empty, it adds the headline overlay over `[0, D)`, placed with
  `headlineY` from the cue overlays that start before D.
- `shotBurnRequests` runs `styleCues` on the joined timeline (D from
  `clips[0]`), then splits with `cuesForShot`. Only shot 0's request gets
  `firstShotDuration = D` (so only it carries the headline and punch-in).
  `burnSubtitlesByShot`'s whole-video fallback passes D from `clips[0]`, or
  null with no clips.
- **Cache keys** cover everything that changes pixels: each cue's
  variant, the hook position when the shot has a hook cue, the headline and
  the punch-in (shot 0 only). Toggling a hook setting re-encodes shot 0
  (and a shot a straddling cue reaches into), not every shot.
- **"Nothing to burn"** now means no translated cue **and** no headline
  **and** no punch-in, in three places:
  - `burnRequest` returns `normalizeRequest`.
  - `burnSubtitlesByShot` returns `combinedBlob`.
  - `burnSubtitles` returns the video unchanged.
- **ffmpeg path:** `burnSubtitlesFFmpeg` takes the rendered `overlays`
  (start, end, image, y) instead of cues plus parallel arrays, since the
  headline overlay has no cue. `buildOverlayFilterGraph(ys, baseFilter?)`
  prepends the optional `zoompan` stage.

## Error handling

No new failure modes beyond today's. A hook overlay is just another PNG
overlay, and punch-in runs inside the existing `process` callback. A
failing WebCodecs encode still falls back exactly as today (whole-video
WebCodecs, then ffmpeg). Emphasis parsing never throws: unmatched markers
stay literal.

## Testing

- **`subtitleLayout.test.ts`**
  - The hook variant uses `HOOK_EN_STYLE`/`HOOK_JA_STYLE` sizes.
  - A short hook cue lays out at 100 px.
  - A long one shrinks to no less than 72 px and to at most 3 lines when it
    fits.
  - The box is taller than the normal variant's.
  - `runs` mirror `lines` with markers removed.
  - `layoutHeadline` caps at 2 lines and shrink-wraps.
- **`subtitleEmphasis.test.ts`**
  - Pairs are parsed, and unpaired or space-padded `*` stay literal.
  - Several emphasized words work.
  - Runs are recovered across line breaks (Latin and Japanese) and across
    collapsed whitespace.
  - `stripEmphasis` removes the markers.
- **`subtitleHook.test.ts`**
  - Hook marking by `start < D`, including a straddling cue.
  - The earliest hook cue starts at 0, and later ones keep their timing.
  - Style off → all normal, timing unchanged.
  - `punchInScale` at 0, D/2, ≥ D.
  - `headlineY` above the topmost box, with no boxes, and clamped at 0.
- **`subtitleCues.test.ts`**
  - `cuesForShot` keeps extra fields.
  - `buildClaudePrompt` strips markers.
- **`shotTrim.test.ts`**
  - The first shot uses `firstShotPaddingStart`.
  - A shot override wins.
  - Non-first shots are unchanged.
- **`shotEncoding.test.ts`**
  - Shot 0's request carries hook cues, the headline and the punch-in.
  - A straddling cue is hook in shot 1 too.
  - Changing the headline changes only shot 0's key.
  - The headline alone (no translated cue) still yields a burn request.
- **`burnSubtitles.test.ts`**
  - `buildOverlayFilterGraph` with a `zoompan` base.
  - Hook cues are placed at the hook position.
  - The headline overlay spans `[0, D)`.
- **`useSettings.test.ts`**: the new defaults, and old stored settings
  merge with them.
- **`SubtitleWorkflow.test.tsx`**
  - The hook toggles call `onHookSettingsChange`.
  - The headline input appears only when on and updates state.
  - The position presets are disabled with the hook style off.
- **`SubtitleOverlayPreview.test.tsx`**
  - A hook cue renders with hook font sizes at the hook position.
  - An emphasized word renders in its own highlighted span.
  - The headline shows only before D.
  - A Whisper-style first cue starting at 0.3 s shows at 0.
- **`FinalizePage.test.tsx`**
  - The first shot's auto-trim uses the first-shot padding.
  - The headline survives a reload via saved subtitles.
- **`SettingsPage.test.tsx`**: the first-shot lead-in slider updates
  settings.
- The existing suite passes.

Per memory: run `tsc -b` (not `--noEmit -p .`) and keep stale worktrees out
of vitest runs.

## Rollout — two PRs

1. **PR 1 — hook style, first frame, emphasis (items 1–3).**
   - `subtitleHook.ts` (`styleCues`, `HookOptions` with `style` + `position`).
   - `subtitleEmphasis.ts`, plus the hook layout and variant rendering.
   - Both burn paths, and the preview.
   - Settings `hookStyleEnabled` + `hookPosition`, and the subtitle-step UI
     for them.
2. **PR 2 — headline, first-shot lead-in, punch-in (items 4–6).**
   - `HookOptions.headline`/`punchIn`, `SubtitleState.hookHeadline` and its
     persistence, the headline layout, render and placement.
   - `firstShotPaddingStart` and its Settings slider.
   - Punch-in in `createOverlayProcess`, the ffmpeg `zoompan` and the
     preview transform.
   - The remaining subtitle-step toggles.

Each PR leaves the app shippable: PR 1's `HookOptions` simply lacks the
fields PR 2 adds.
