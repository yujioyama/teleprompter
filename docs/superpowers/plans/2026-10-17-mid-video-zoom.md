# Mid-Video Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Peaks (middle shots whose English subtitle has an emoji) drift in from 1.0x to 1.12x. The last shot punches in to 1.18x at the cut. This works in the preview and in both WebCodecs burns, and is recorded in the video record.

**Architecture:** A pure planner in `src/utils/midZoom.ts` turns cues plus shot durations into zoom segments on the joined timeline. It mirrors the fairy plan. The segments ride on `SubtitleLook` (sliced per shot like the fairies) into `createOverlayProcess`. That function already zooms the picture for the first shot's punch-in, and gains a second source of scale.

**Tech Stack:** React 18 + TS, Vitest, Mediabunny/WebCodecs, OffscreenCanvas.

**Spec:** `docs/superpowers/specs/2026-10-17-mid-video-zoom-design.md`

## Global Constraints

- `PEAK_ZOOM = 1.12` (drift over the whole shot, eased with `easeZoom`). `PUNCHLINE_ZOOM = 1.18` (the whole last shot). The anchor is `ZOOM_ANCHOR_Y`.
- A peak is a shot with index 1..n-2 whose joined English text (`shotTextsOf`) contains an emoji (`findSticker`). The punchline is shot n-1. Nothing happens when n < 2 or `hook.midZoom === false`.
- This is independent of `hook.fairies`, `hook.sticker` and whether a cameo fits.
- Setting `midZoomEnabled` defaults to true. UI copy is 「中盤のズーム」.
- The ffmpeg.wasm path gets no mid zoom.
- Test with `npx vitest run <files>`. Types with `npx tsc -b`.

## Review Focus

- A shot that zooms but has no translated cue and no fairy must still be burned, not passed through as the plain normalized clip. (Task 3 test)
- Changing only a peak's emoji must re-key only that shot's burn. (Task 3 test)
- A last shot that also has the finale fairy: zoom and finale together, and the finale is not scaled. (Covered by the overlay drawing the zoom before the sprites. Task 2 test: the scale is applied with cues active.)
- The whole-video fallback (`burnSubtitles` WebCodecs) must zoom the same as the per-shot path. (Task 3 test via the options passed)
- Preview: the zoom must also show between `timeupdate` ticks, so `followsFrames` covers the drifts. (Task 1 test)

---

### Task 1: Planner, scale and hook option

**Files:**
- Create: `src/utils/midZoom.ts`, `src/utils/midZoom.test.ts`
- Modify: `src/utils/subtitleHook.ts` (`HookOptions.midZoom?: boolean`, `HookSettings` + `'midZoomEnabled'`, `hookOptionsOf`, `followsFrames(..., midZoom: MidZoomSegment[] = [])`), `src/hooks/useSettings.ts` (`midZoomEnabled: boolean`, default true), tests in `subtitleHook.test.ts`, `useSettings.test.ts`

**Interfaces (produces):**
- `export interface MidZoomSegment { start: number; end: number; kind: 'drift' | 'punch' }`
- `planMidZoom(cues: { start: number; en: string }[], durations: number[], hook: Pick<HookOptions, 'midZoom'>): MidZoomSegment[]`
- `midZoomForShot(plan: MidZoomSegment[], shotStart: number, shotDuration: number): MidZoomSegment[]` (segments inside the shot, rebased to its own time)
- `midZoomScale(t: number, segments: MidZoomSegment[]): number`

- [ ] Tests:
  - 5 shots with emoji in shots 0, 2 and 4 → `[drift(shot 2), punch(shot 4)]`
  - a single shot → `[]`
  - `midZoom: false` → `[]`
  - two shots → `[punch(shot 1)]`
  - `midZoomScale`: 1 outside; drift at start, mid and end is 1, 1.06 and →1.12; punch is 1.18 at start and end-ε
  - `midZoomForShot` rebases
  - `followsFrames` is true mid-drift and false in a plain shot
  - `hookOptionsOf` maps `midZoomEnabled`
  - settings default true
- [ ] Implement and make them pass. Commit `feat: plan the mid-video zoom: peaks drift in, the punchline punches in`.

### Task 2: Overlay zooms by the segments

**Files:** Modify `src/utils/webcodecs/subtitleOverlay.ts` (`OverlayOptions.midZoom?: MidZoomSegment[]`; scale = first-shot punch-in while `t < until`, else `midZoomScale`), `src/utils/webcodecs/normalizeShot.ts` (an overlay is needed when `midZoom` is non-empty too). Test: the existing overlay test file.

- [ ] Tests:
  - a frame inside a drift returns a canvas (zoomed), and one outside with no cue returns the sample
  - with `punchIn` and segments, the first shot uses the punch-in
- [ ] Implement. Commit `feat: zoom the picture by the mid-video zoom in the WebCodecs overlay`.

### Task 3: Burns carry the segments

**Files:** Modify `src/utils/burnSubtitles.ts` (`SubtitleLook.midZoom?: MidZoomSegment[]`; `burnSubtitles` and `burnShotSubtitles` pass it to the overlay; "nothing to burn" checks count it), `src/utils/shotEncoding.ts` (`shotBurnRequests` plans once and slices per shot; `burnRequest` burns a zoomed shot and keys it by its segments; `burnSubtitlesByShot` early return and fallback). Tests: `shotEncoding.test.ts`, `burnSubtitles.test.ts`.

- [ ] Tests:
  - a zoomed shot with no translated cues is a burn request, not `normalizeRequest`
  - editing a peak emoji changes only that shot's key
  - the whole-video fallback receives the segments
- [ ] Implement. Commit `feat: burn the mid-video zoom shot by shot and in the whole-video fallback`.

### Task 4: Preview, setting UI, record, connector copy

**Files:**
- Modify: `src/components/SubtitleWorkflow.tsx` (plan from `cues` and `shotCueInputs`; `previewZoom` uses the punch-in in the first shot, else `midZoomScale`; `followsFrames` gets the plan; checkbox 「中盤のズーム」 after the ズーム block, with hint 「途中の山場（英語字幕に絵文字がある行）でじわっと寄り、最後のオチはカットの瞬間に寄ります（字幕は拡大しません）」)
- Modify: `src/pages/FinalizePage.tsx` (the `hookSettings` memo includes `midZoomEnabled`)
- Modify: `shared/videoRecord.ts` (`effects.midZoom: z.boolean().optional()`), `src/utils/videoRecord.ts` (`midZoom = burn ? planMidZoom(...).length > 0 : false`)
- Modify: `server/mcp.ts`. The middle-emoji sentence becomes 「途中の行（1行目と最終行以外）のうち、話の山場（話が転がる行や、オチの直前の盛り上がり）の行に、合計で最大2行まで絵文字を1つずつ入れます。…その行では画面がじわっと寄ります」. The records description mentions `midZoom`.
- Tests: `SubtitleWorkflow.test.tsx`, `videoRecord.test.ts`, `server/mcp.test.ts`, and `server/recordsApi.test.ts` (a record without `midZoom` parses)

- [ ] Tests first, then implement. Run the full suite, `tsc -b` and lint. Commit `feat: preview and record the mid-video zoom, and switch it in the subtitle step`.

### Task 5: Ship

- [ ] Final whole-branch review and fixes.
- [ ] Browser preview of the subtitle step.
- [ ] PR, CI, merge (`gh pr merge --merge`).
- [ ] Hand the user the routine prompt v3, with the 山場-only emoji rule and "midZoom" in the effects line.
