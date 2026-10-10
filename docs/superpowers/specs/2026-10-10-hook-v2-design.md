# Hook v2: Snap Zoom, Outlined Subtitles, Auto Emphasis

**Date:** 2026-10-10
**Status:** Approved (brainstorming)
**Replaces parts of:** `2026-10-08-hook-first-shot-design.md` (punch-in,
hook subtitle look, hook headline)

## Problem

Using the hook from 2026-10-08 on real videos:

- **Punch-in:** 1.0 → 1.08 spread over the whole first shot is too slow to
  notice.
- **Hook subtitle:** a big dark box covers the middle of the frame, hiding
  the face and the punch-in.
- **Band opacity:** going from 0.55 to 0.8 makes no visible difference.
- **Emphasis:** adding `*…*` by hand every time is tedious.
- **Hook headline:** it competes with the subtitle, which already takes
  the frame's width. It isn't needed.

## Goal

1. **Snap zoom.** The first shot jumps from 1.0 to 1.25 at about 0.4 s,
   holds until the cut, and drops back to 1.0 on the second shot.
2. **Impact effect.** A short zoom blur and RGB split ride on the snap.
3. **Outlined subtitles.** Every subtitle, normal and hook, loses its box
   and is drawn as white text with a black outline and a soft shadow. Hook
   cues are English-only, smaller than before, and sit near the top.
4. **Auto emphasis.** Scripts from the inbox already carry `*…*`. The
   teleprompter hides the markers. Subtitles rebuilt 「話した音声から」 get
   the markers back on the same phrases.
5. **No headline.** The hook headline and everything behind it is removed.

Everything must look the same in four places: the per-shot burn, the
whole-video burn (WebCodecs), the ffmpeg.wasm last resort (except the
impact effect, see below), and `SubtitleOverlayPreview`.

## Look: modern, not dated

This applies to every visual choice below.

- **Font.** Use the system font stack `system-ui, -apple-system, "Hiragino
  Sans", "Noto Sans JP", sans-serif` instead of the bare `sans-serif`.
  - On iPhone, where both burns and the preview run, this gives SF Pro and
    Hiragino Sans.
  - These are current, native-looking faces, and nothing has to be
    downloaded.
  - One constant, `SUBTITLE_FONT_FAMILY`, is used by the canvas `font`
    shorthand and by the preview's CSS, so both measure alike.
- **Weights.** English uses `800`, which is heavy without looking like
  cartoon lettering. Japanese uses `bold` (Hiragino W6). A thin weight
  under an outline smudges.
- **Outline.** Keep it crisp and moderate:
  - stroke width = 12% of the font size, with `lineJoin: 'round'`
  - no hard offset shadow
  - the depth comes from a soft, diffuse shadow under the outline:
    `rgba(0,0,0,0.35)`, blur 15% of the font size, offset y 4%
- **Color.** Pure white text, and emphasis in `#FFD60A`. No translucent
  grey for Japanese: the two lines differ by size only.
- **Motion.**
  - The snap uses a quint ease-out, which moves fast and then settles
    smoothly, rather than a linear or cubic ramp.
  - The impact effects are short (0.15 s) and decay with the zoom's own
    velocity. They read as a camera hit, not a glitch filter. Even
    「強」 stays subtle.

## Definitions

These are unchanged from the 2026-10-08 spec:

- **First shot**, `combinedClips[0]`, length **D**.
- A **hook cue** is a cue with `start < D` on the joined timeline. `styleCues`
  decides this, and it still moves the earliest hook cue to start at 0 s.

## Design

### 1. Snap zoom: `src/utils/subtitleHook.ts`

```ts
export const SNAP_DURATION = 0.12     // seconds the zoom takes to land
export const ZOOM_ANCHOR_Y = 0.4      // zoom about (50%, 40%): roughly the face
export type PunchInZoom = 1.15 | 1.25 | 1.35

export interface PunchIn {
  zoom: PunchInZoom
  /** Seconds into the first shot when the zoom starts. */
  at: number
  /** The impact effect riding on the snap; null = off. */
  impact: ImpactStrength | null
}

/** easeOutQuint(p) = 1 - (1 - p)^5 */
export function snapZoomScale(t: number, punchIn: Pick<PunchIn, 'zoom' | 'at'>, until: number): number
```

- When `t < at` or `t >= until`, the scale is `1`. So the second shot, or
  any `t >= D` on the joined timeline, is back at 1x, and the cut makes the
  second change.
- Otherwise the scale is `1 + (zoom - 1) * easeOutQuint(min((t - at) / SNAP_DURATION, 1))`.
- When `at >= until`, the scale is always `1`.
- `punchInScale` and `PUNCH_IN_ZOOM` are removed. `punchInUntil(hook,
  firstShotDuration)` stays, and still returns `D` or `null`.
- **Drawing (WebCodecs).** `createOverlayProcess` draws the sample scaled
  by `s` about the anchor `(W/2, ZOOM_ANCHOR_Y·H)`:
  - `dx = W/2·(1-s)`, `dy = ZOOM_ANCHOR_Y·H·(1-s)`, size `W·s × H·s`
  - The anchor lies inside the frame, so a scaled frame always covers it.
- **ffmpeg.wasm.** `punchInFilter(punchIn, until)` builds a `zoompan` with:
  - frame time `T = (in+0.5)/30`, the frame midpoint, matching `process`
  - `z = if(lt(T,at),1,if(lt(T,until),1+(zoom-1)*(1-pow(1-min((T-at)/0.12,1),5)),1))`
  - `x = iw/2 - iw/zoom/2` and `y = ih*0.4 - ih*0.4/zoom`

  The impact effect is skipped on this path (decided in brainstorming). It
  is the last resort for devices without WebCodecs.

### 2. Impact effect: `src/utils/webcodecs/pictureEffects.ts` (new)

The pure part lives in `subtitleHook.ts`:

```ts
export type ImpactStrength = 'weak' | 'medium' | 'strong'
export const IMPACT_DURATION = 0.15
export const IMPACT_LEVELS: Record<ImpactStrength, { blurSpread: number; rgbShiftPx: number }> = {
  weak:   { blurSpread: 0.03, rgbShiftPx: 4 },
  medium: { blurSpread: 0.06, rgbShiftPx: 8 },
  strong: { blurSpread: 0.09, rgbShiftPx: 12 },
}

/** Effect amounts at `t`, or null outside [at, at + IMPACT_DURATION). */
export function impactAt(t: number, at: number, strength: ImpactStrength):
  { blurSpread: number; rgbShiftPx: number } | null
```

- The intensity is `k = (1 - u)^4`, where `u = (t - at) / IMPACT_DURATION`.
  This is the quint ease-out's velocity shape, `5(1-p)^4`, normalised. Each
  amount is `level × k`.
- `rgbShiftPx` is measured at the 1080 px output width. The output is
  always 1080 wide, so it is used as-is.
- When `t >= until`, the result is null as well (a first shot shorter than
  `at + 0.15`).

The drawing part, `drawImpactFrame(ctx, sample, scale, amounts, scratch)`,
uses only `OffscreenCanvas` 2D:

- **Zoom blur.** Draw the zoomed picture `N = 5` times at scales
  `s·(1 + blurSpread·j/(N-1))` for `j = 0…4`, about the anchor. Layer `j`
  gets `globalAlpha = 1/(j+1)`, a running average, so the stack is an
  equal-weight mean that streaks outward from the anchor.
- **RGB split.** Draw the blurred picture three times:
  1. red at `dx = -rgbShiftPx`
  2. green at `dx = 0`
  3. blue at `dx = +rgbShiftPx`

  Each copy goes onto the scratch canvas, which is then filled with pure
  `#f00`, `#0f0` or `#00f` under `globalCompositeOperation = 'multiply'`
  to keep that one channel. The three copies are summed onto the output
  with `'lighter'`.
- The copies are drawn from the sample itself, not from a frame-sized
  canvas. At ≥ 1.15x the sample extends past the frame, so shifting leaves
  no empty strip at the edges.
- **Scratch memory.** One extra 1080×1920 `OffscreenCanvas` is created on
  the first impact frame and dropped (`width = height = 0`) once `t`
  passes the window. Nothing extra stays alive for the rest of the encode,
  which matters for iPhone memory (OOM reloads).
- **Cost.** At 30 fps the window is about 5 frames, and only those frames
  do the extra draws (about 15 draws plus 3 fills each). Every other frame
  of shot 0 does what the punch-in already does: one scaled draw, then the
  overlays.
- The **subtitles stay untouched.** The overlays are composited after the
  effect.

`createOverlayProcess(overlays, { punchIn?: PunchIn | null, until?: number | null })`
replaces the `punchInUntil` option. `normalizeShotWebCodecs` and
`burnSubtitlesWebCodecs` pass it through.

### 3. Outlined subtitles: `src/utils/subtitleLayout.ts`, `burnSubtitles.ts`

**Styles**

```ts
export const SUBTITLE_FONT_FAMILY = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'
export const EN_STYLE:      TextStyle = { weight: '800',  maxPx: 60, minPx: 44, maxLines: 3, lineHeight: 1.25 }
export const JA_STYLE:      TextStyle = { weight: 'bold', maxPx: 50, minPx: 38, maxLines: 3, lineHeight: 1.4 }
export const HOOK_EN_STYLE: TextStyle = { weight: '800',  maxPx: 80, minPx: 64, maxLines: 3, lineHeight: 1.2 }
export const SUBTITLE_MARGIN_X = 90                       // was SUBTITLE_BOX_MARGIN_X
export const SUBTITLE_TEXT_WIDTH = 1080 - 2 * 90          // 900, was 820
export const OUTLINE_WIDTH_RATIO = 0.12
export const SHADOW = { color: 'rgba(0,0,0,0.35)', blurRatio: 0.15, offsetYRatio: 0.04 }
/** Room above and below the text for the outline and shadow, in px. */
export const SUBTITLE_PADDING_Y = 20
```

- `fontFor(style, px)` returns `` `${style.weight} ${px}px ${SUBTITLE_FONT_FAMILY}` ``.
- Removed: `SUBTITLE_BOX_OPACITY`, `SUBTITLE_BOX_PADDING_X`,
  `SUBTITLE_BOX_PADDING_Y`, `SUBTITLE_BOX_RADIUS`, `HOOK_JA_STYLE`,
  `HEADLINE_STYLE`, `HEADLINE_BOX_OPACITY`, `layoutHeadline`, and
  `HeadlineLayout`.

**Layout**

- `textStylesFor('hook')` returns `{ en: HOOK_EN_STYLE, ja: null }`.
- `layoutCue(cue, measure, 'hook')` therefore returns `ja: null` even when
  the cue has Japanese.
- Hook cues show English only. From the second shot on, cues keep both
  lines.
- `height = SUBTITLE_PADDING_Y·2 + en lines·lineHeightPx [+ SUBTITLE_BLOCK_GAP + ja lines·lineHeightPx]`.
  `CueLayout.height` is still the rendered image height, so the
  `clampedSubtitleY` placement is unchanged.
- The burn still skips a cue with `ja === null`, hook or not. Every burn
  waits until all cues are translated anyway.

**Drawing.** `renderCueImage(cue, variant)` draws each line in two passes,
with a shared helper `drawOutlinedRuns(ctx, runs, centerX, y, fontPx)`:

1. **Outline pass.** Shadow on, `strokeStyle = '#000'`,
   `lineWidth = round(fontPx·0.12)`, `lineJoin = 'round'`; `strokeText`
   each run.
2. **Fill pass.** Shadow off; `fillText` each run in white, or
   `EMPHASIS_COLOR` for emphasized runs.

The fill drawn over the stroke keeps thin strokes of the letters open.

**Preview (`SubtitleOverlayPreview`)**

- The box styling is removed.
- Text uses `font-family: SUBTITLE_FONT_FAMILY` and the same weights, plus:
  - `-webkit-text-stroke: <0.12·fontPx in cqw> #000`
  - `paint-order: stroke fill`, so the stroke sits under the fill like the
    canvas
  - `text-shadow: 0 <0.04·px> <0.15·px> rgba(0,0,0,0.35)`
- Hook cues render English only, sized from `HOOK_EN_STYLE`.
- The width is `cqw(SUBTITLE_TEXT_WIDTH)`, and the vertical padding is
  `cqw(SUBTITLE_PADDING_Y)`.

**Hook position default.** `hookPosition` defaults to
`SUBTITLE_POSITION_TOP` (13.75), above the face, so the zoom stays visible.

### 4. Auto emphasis

- **Inbox.** The MCP tool description (`server/mcp.ts`) gains one line: 「各行の要になる語句（1行に0〜1か所）を `*…*` で囲む」.
  The script body is stored as sent, markers included.
- **Teleprompter.** In `RecordPage`, the prompt text (`currentShot.text`)
  and the shot list render `stripEmphasis(shot.text)`. The script editor
  keeps showing the raw text, so the markers stay editable.
- **Script-made cues** already carry the markers, because `cuesFromShotEntries`
  copies the shot text. No change is needed.
- **Speech-made cues.** Add `reapplyEmphasis` in `src/utils/subtitleEmphasis.ts`:

  ```ts
  /** Mark the script's *phrases* again on cues transcribed from speech. */
  export function reapplyEmphasis(cues: SubtitleCue[], scriptTexts: string[]): SubtitleCue[]
  ```

  - **Phrases:**
    - every `*…*` pair in `scriptTexts`, in script order, found with the
      same `MARKER` regex
    - each phrase is split into words and normalised: NFKC, lowercase, and
      every character that isn't `\p{L}` or `\p{N}` removed
    - words that normalise to `''` are dropped
  - **Cue words:** each cue's `en` is split on whitespace. For every word,
    keep its normalised form and its core span in `en`, which is the word
    minus leading and trailing punctuation.
  - **Matching:**
    - Walk the phrases in order, with a cursor of (cue index, word index).
    - For each phrase, find the first run of consecutive words inside a
      single cue, at or after the cursor, whose normalised forms equal the
      phrase's words.
    - On a match, wrap `en` from the first word's core start to the last
      word's core end in `*…*`, then move the cursor past the match. So
      `"I said, carry a torch."` becomes `"I said, *carry a torch*."`
    - With no match, skip the phrase and leave the cursor where it is.
  - Phrases that would span two cues are not matched.
  - Each script phrase marks at most one place (decided in brainstorming).
  - Cues with no match come back unchanged, as the same object.
  - **Call site:** `SubtitleWorkflow.handleTranscribe` applies
    `reapplyEmphasis(transcribed, shotCueInputs.map(s => s.text))` before
    storing the cues.
  - Manual editing is unchanged. The hint 「*で囲んだ語は黄色で強調されます」
    stays.

### 5. Remove the hook headline

These all go:

- `SubtitleState.hookHeadline`, its input and its placeholder.
- `FinalizePage`'s headline handling: keeping it across a re-combine, and
  saving and loading it.
- `SavedSubtitles.hookHeadline`. Old records that still have the field
  load fine, because the field is simply ignored.
- `AppSettings.hookHeadlineEnabled`.
- `HookOptions.headline`, `hookOptionsOf`'s `headline` argument,
  `HEADLINE_GAP`, `OverlayBox` and `headlineY`.
- `renderHeadlineImage`, and the headline overlay in
  `renderSubtitleOverlays`.
- The headline part of the burn cache key.
- The `hook-headline` preview block and its CSS.
- Every test covering these.

`hasFirstShotExtras(hook, D)` becomes `D !== null && hook.punchIn !== null`.

### 6. Settings and UI

`AppSettings` changes:

| field | change | default |
|---|---|---|
| `hookHeadlineEnabled` | removed (dropped from stored settings on load) | – |
| `hookPosition` | new default | `SUBTITLE_POSITION_TOP` |
| `punchInEnabled` | kept, now labelled スナップズーム | `true` |
| `punchInZoom` | new, `1.15 \| 1.25 \| 1.35` | `1.25` |
| `punchInAt` | new, 0–1.5 s, step 0.1 | `0.4` |
| `impactEnabled` | new | `true` |
| `impactStrength` | new, `'weak' \| 'medium' \| 'strong'` | `'medium'` |

**Migration.** Applied in `loadSettings`, once:

- When stored settings lack `punchInZoom` (saved before this change) and
  have `hookPosition === SUBTITLE_POSITION_CENTER`, `hookPosition` becomes
  `SUBTITLE_POSITION_TOP`.
- A position the user moved anywhere else is kept.
- `hookHeadlineEnabled` is deleted from the loaded object.

**`HookOptions`.**
`{ style: boolean; position: SubtitlePosition; punchIn: PunchIn | null }`.
`hookOptionsOf(settings)` builds `punchIn` as follows:

- `null` when `punchInEnabled` is off
- otherwise `impact` is `null` when `impactEnabled` is off, or
  `impactStrength` when it is on

`HookSettings` lists the new fields.

**Subtitle step.** The 「最初のショット（フック）」 block holds:

- **フック字幕** toggle and **位置**, as today.
- **スナップズーム** toggle. While it's on:
  - **倍率**: three buttons, 1.15 / 1.25 / 1.35
  - **寄るタイミング**: a slider from 0 to 1.5 s, shown as `0.4秒`
- **インパクト効果** toggle and **強さ** (弱 / 中 / 強). Both are disabled
  while スナップズーム is off.

**Burn cache key.** Shot 0's key covers `zoom`, `at` and `impact`,
replacing the punch-in boolean. Other shots' keys don't depend on them.

### 7. Preview

- **Zoom.** The subtitle step's `<video>` gets:
  - `transform: scale(snapZoomScale(previewTime, punchIn, D))`
  - `transform-origin: 50% 40%`

  The subtitle overlay is a sibling, so it doesn't scale.
- **Smooth time.** `timeupdate` fires about 4 times a second, which would
  hide a 0.12 s snap. While the video plays, `previewTime` is updated from
  `requestVideoFrameCallback` where available, and `requestAnimationFrame`
  otherwise. While paused or seeking, `timeupdate` and `seeked` update it
  as today.
- **Not previewed.** The impact effect is not shown in the preview. It is
  5 frames, and you check it in the burned result.

## Error handling

There are no new failure modes. The effects run inside the existing
`process` callback. If the impact drawing throws (for example, the scratch
canvas fails to allocate), the encode fails and falls back exactly as
today: whole-video WebCodecs, then ffmpeg without the impact. Emphasis
reapplication never throws, and an unmatched phrase is skipped.

## Testing

- **`subtitleHook.test.ts`**
  - `snapZoomScale`:
    - 1 before `at`
    - `easeOutQuint(0.5)` mid-snap
    - `zoom` at `at + 0.12` and while holding
    - 1 at `until`
    - 1 when `at >= until`
  - `impactAt`:
    - null outside the window
    - the full level at `at`
    - `(1-u)^4` decay
    - null past `until`
  - `hookOptionsOf` maps the settings, including `punchIn: null` and
    `impact: null`.
  - `hasFirstShotExtras`.
  - The headline tests are removed.
- **`subtitleLayout.test.ts`**
  - A hook cue lays out English only, at 80 px, shrinking to no less than
    64 px.
  - Normal cues keep both lines.
  - Height = padding + lines.
  - The wrap width is 900.
  - `fontFor` uses the font stack and the weights.
- **`subtitleEmphasis.test.ts`**: `reapplyEmphasis` handles
  - case and punctuation differences
  - punctuation kept outside the markers
  - phrases taken in order, each marking one place, with a repeated word
    marked only once
  - an unmatched phrase, which is skipped and doesn't move the cursor
  - a phrase across two cues, which is not matched
  - several phrases in one cue
  - a script with no markers, which leaves the cues unchanged
- **`subtitleOverlay.test.ts`**
  - The zoom draws about the 40% anchor.
  - Impact frames use the scratch canvas, and non-impact frames don't.
  - The scratch canvas is released after the window.
  - Overlays are drawn after the effect.
- **`burnSubtitles.test.ts`**
  - `punchInFilter` expression and anchor.
  - The headline overlay tests are removed.
- **`shotEncoding.test.ts`**
  - Shot 0's key changes with `zoom`, `at` or `impact`, and other shots'
    keys don't.
  - The headline cases are removed.
- **`useSettings.test.ts`**
  - The new defaults.
  - Migration: an old center position becomes top, a custom position is
    kept, and `hookHeadlineEnabled` is dropped.
- **`SubtitleOverlayPreview.test.tsx`**
  - Outlined styling, with no box background.
  - A hook cue shows no Japanese.
  - The headline tests are removed.
- **`SubtitleWorkflow.test.tsx`**
  - The zoom and impact controls call `onHookSettingsChange`.
  - The impact controls are disabled while the zoom is off.
  - Transcribed cues get the script's emphasis.
  - The headline input is gone.
- **`RecordPage.test.tsx`**: the prompt text hides the `*` markers.
- **`server/mcp.test.ts`**: the description mentions `*…*`.
- The existing suite passes. Run `tsc -b`, and remove leftover
  `.claude/worktrees/*` from the vitest scan where needed.

**On device** (with a `vercel deploy` preview, and the PWA relaunched):

- Burn a video with the impact effect on and off, and compare shot 0's
  encode time.
- If the effect adds more than about 10%, profile and trim the work
  first: fewer blur layers, or a half-resolution scratch canvas.
- Check by eye that the outlined subtitles, snap and impact match the
  preview and look modern.
- Check them at the top, center and bottom presets.

## Non-goals

- Previewing the impact effect.
- Impact effect on the ffmpeg.wasm path.
- A per-word pop-in or any other animated subtitle.
- Emphasis matching across cue boundaries, or fuzzy (misheard) matches.
- Custom outline, shadow or font settings.
