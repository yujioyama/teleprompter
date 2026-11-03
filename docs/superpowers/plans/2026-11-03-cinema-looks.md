# Cinema Looks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Type A/B script's opening gets a picked film look (ハリウッド風, 昔のフィルム, 夜の青, 白黒, グリッチ) between the bars, fading out with them; Claude can recommend it with the script.

**Architecture:** The look's math (color LUT, vignette, grain noise, dust specs, glitch params) lives in pure functions over pixel arrays (`src/utils/cinemaLook.ts`). One canvas-2D drawer (`drawCinemaLook`) applies it to a context whose picture is already drawn; the hardware burn (`drawOpening`) and a new preview canvas both call it. The pick rides on `OpeningLook.grade`, so the first shot's encode cache key and the record pick it up from the existing plumbing.

**Tech Stack:** TypeScript, React, Vitest (jsdom), Mediabunny/WebCodecs (OffscreenCanvas 2D), ffmpeg.wasm fallback, MCP server (zod), Upstash Redis inbox.

**Spec:** `docs/superpowers/specs/2026-11-03-cinema-looks-design.md`. Reference implementation: `docs/superpowers/specs/2026-11-03-cinema-looks-reference.html` (its `<script>`: `LOOKS`, `vignetteMask`, `glitchFrame`, `grainFrames`, `dustFrames`, `paint`).

## Global Constraints

- Look ids, exactly: `hollywood`, `oldFilm`, `nightBlue`, `mono`, `glitch`. UI labels, exactly: なし, ハリウッド風, 昔のフィルム, 夜の青, 白黒, グリッチ.
- Fixed strength: the reference at k = 1 and vignette strength 0.6. No strength control anywhere.
- Only Type A/B scripts get a look; untyped scripts are unchanged.
- The look is drawn over the picture, under the subtitles, sticker and bars; at opacity `1 − ease((t − at)/0.8)` (same smoothstep as the bars); untouched after `openingEnd`.
- Sizes are relative to the frame: grain texture always 270×480 scaled to the frame; every reference pixel length × (frame width / 540).
- Grain, dust and glitch settings change on `floor(t × 12)`, seeded by it (re-encodes match). The glitch is redrawn from every video frame.
- No WebGL on the burn path. No new encode in the export step.
- Old scripts, inbox items and records without a look still load; absent = none.
- Type check with `npx tsc -b` (not `tsc --noEmit -p .`). Tests: `npx vitest run <file>`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; keep the given message text exactly.

## Review Focus

1. A look sent without a type: kept on the script but draws nothing; if the user then gives the script a type, the look applies. (Task 5)
2. A first shot shorter than the opening: `openingPlan` moves `at` earlier, and the look must be fully faded by the first shot's end, not snap off at the cut. (Task 1)
3. Old data: a script, inbox item or record without `look` loads and means none; a record written with one parses back. (Tasks 5, 6)
4. The preview while paused or scrubbing shows no look (like the bars), and stops drawing once the opening is over, so it doesn't cost frames for the rest of the video. (Task 4)
5. Changing the look re-burns the first shot only: the other shots' cache keys don't change. (Task 3)

---

### Task 1: Look math and the opening's fade

**Files:**
- Create: `shared/cinemaLook.ts`
- Create: `src/utils/cinemaLook.ts`, `src/utils/cinemaLook.test.ts`
- Modify: `src/utils/openingLook.ts`, `src/utils/openingLook.test.ts`, `src/utils/subtitleHook.ts`
- Modify (comments only): `shared/inbox.ts` (VideoType doc: "Each gets its own opening look" → both get the bars, see openingLookFor), `src/utils/webcodecs/subtitleOverlay.ts` (`OverlayOptions.opening`: "black bars, color pop" → "black bars and the picked look")

**Interfaces:**
- Produces (`shared/cinemaLook.ts`): `export const CINEMA_LOOKS = ['hollywood', 'oldFilm', 'nightBlue', 'mono', 'glitch'] as const`; `export type CinemaLook = (typeof CINEMA_LOOKS)[number]`; `export const CINEMA_LOOK_LABELS: Record<CinemaLook, string>` (ハリウッド風, 昔のフィルム, 夜の青, 白黒, グリッチ).
- Produces (`src/utils/cinemaLook.ts`):
  - `LOOK_GRAIN: Record<CinemaLook, number>` = `{ hollywood: 0, oldFilm: 1, nightBlue: 0.25, mono: 0.5, glitch: 0 }`; `LOOK_HAS_DUST: (look) => look === 'oldFilm'`.
  - `lookColor(look: Exclude<CinemaLook, 'glitch'>, r: number, g: number, b: number): [number, number, number]` — the reference `fn` at k = 1, values 0–1.
  - `buildLut(look: Exclude<CinemaLook, 'glitch'>): Lut` and `lutApply(lut: Lut, r: number, g: number, b: number): [number, number, number]` (0–255 in and out). `Lut` is the builder's choice of type.
  - `vignetteMask(width: number, height: number): Float32Array` — strength 0.6, cached per size.
  - `gradePixels(data: Uint8ClampedArray, width: number, height: number, lut: Lut, mask: Float32Array): void` — in place: LUT then × mask.
  - `glitchParams(step: number, width: number, height: number): GlitchParams` with `GlitchParams = { split: number; bands: { y0: number; h: number; dx: number; tint: 0 | 1 | 2 }[] }`, reference ranges × (width / 540), seeded by `step`.
  - `glitchPixels(src: Uint8ClampedArray, out: Uint8ClampedArray, width: number, height: number, params: GlitchParams, mask: Float32Array): void`.
  - `grainNoise(frame: number): Uint8ClampedArray` — 270×480 RGBA, deterministic per frame.
  - `dustSpecs(frame: number, width: number, height: number): DustSpec[]` with `DustSpec = { kind: 'speck' | 'hair' | 'scratch'; ... }` (fields builder's choice), sizes × (width / 540).
  - `lookStep(t: number): number` = `Math.floor(t * 12)`.
- Produces (`src/utils/openingLook.ts`): `OpeningLook` gains `grade: CinemaLook | null`; `openingLookFor(cues, position, grade: CinemaLook | null = null, measure?)`; `lookOpacity(t: number, look: OpeningLook): number` = `1 − ease((t − at)/LETTERBOX.duration)`.
- Produces (`src/utils/subtitleHook.ts`): `withVideoType(hook, type, cues, position, look?: CinemaLook | null)` passes `look ?? null` as the grade.

- [ ] **Step 1: Write the failing tests** in `src/utils/cinemaLook.test.ts` and `openingLook.test.ts`:
  - `lookColor` matches the reference at k = 1 for a few colors, e.g. `lookColor('mono', 1, 0, 0)` is gray (r = g = b); `lookColor('oldFilm', 0, 0, 0)` has every channel ≥ 0.14 (lifted blacks); `lookColor('nightBlue', 0.5, 0.5, 0.5)` has b > r.
  - `lutApply(buildLut(look), …)` is within 2/255 of `lookColor` × 255 for 200 seeded random colors, for each of the four color looks.
  - `vignetteMask(1080, 1920)`: center (540, 864) is 1; corner (0, 0) is `1 − 0.6 × 0.75` within 0.01; same array instance on a second call.
  - `glitchParams(5, 1080, 1920)` equals itself on a second call, differs from `glitchParams(6, …)`; `split` in [12, 32]; 3–6 bands; every `|dx| ≤ 120`.
  - `glitchPixels` with `split = 0` and no bands on a 4×4 image changes saturation only: a gray pixel stays gray.
  - `grainNoise(0)` has length 270 × 480 × 4, mean of R within 128 ± 4, equals `grainNoise(0)` and differs from `grainNoise(1)`.
  - `dustSpecs(0, 1080, 1920)` has 26 specks, 2 hairs, 1–2 scratches; a speck's size at width 1080 is twice its size at 540 for the same frame.
  - `lookOpacity`: 1 at t = 0 and at `at`; 0.5 at `at + 0.4`; 0 at `openingEnd`. With a look moved early by `openingPlan(hook, 1.5)`, `lookOpacity(1.5, plan)` is 0 (Review Focus 2).
  - `withVideoType(HOOK, 'A', lines, 72, 'oldFilm').opening.grade` is `'oldFilm'`; with no look it is `null`; `withVideoType(HOOK, undefined, lines, 72, 'oldFilm')` returns `HOOK` unchanged.
- [ ] **Step 2: Run** `npx vitest run src/utils/cinemaLook.test.ts src/utils/openingLook.test.ts` — expect FAIL (missing exports).
- [ ] **Step 3: Implement** the interfaces above, porting the reference's `LOOKS[*].fn`, `vignetteMask`, `glitchFrame` (split into `glitchParams` + `glitchPixels`), `grainFrames` (as `grainNoise`) and `dustFrames` (as `dustSpecs`). Fix the two stale comments.
- [ ] **Step 4: Run** the same tests, then `npx vitest run` and `npx tsc -b` — expect PASS (update other tests' `OpeningLook` literals with `grade: null` where tsc asks).
- [ ] **Step 5: Commit** — `feat: the film looks' math, and the opening's look fading out with the bars`

### Task 2: Draw the look on a canvas, and pick its processing size

**Files:**
- Create: `src/utils/drawCinemaLook.ts`, `src/utils/drawCinemaLook.test.ts`

**Interfaces:**
- Consumes: Task 1's `buildLut`, `vignetteMask`, `gradePixels`, `glitchParams`, `glitchPixels`, `grainNoise`, `dustSpecs`, `lookStep`, `LOOK_GRAIN`.
- Produces: `drawCinemaLook(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, look: CinemaLook, t: number, opacity: number, width: number, height: number): void` — expects the untouched picture on `ctx`; leaves picture-with-look blended at `opacity`. Caches LUTs, masks, grain canvases (6 frames cycled by `lookStep(t) % 6`) and its scratch canvas across calls. `LOOK_PROCESS_SCALE: 1 | 0.5` (exported const).

- [ ] **Step 1: Write the failing tests** with a fake 2D context (as `openingLook.test.ts`'s `fakeCtx`, extended with `getImageData`/`putImageData`/`drawImage` recording):
  - opacity 0 draws nothing.
  - For `oldFilm`: it reads the picture, writes the graded pixels, then draws a grain canvas with `globalCompositeOperation` `'overlay'` at alpha `min(1, 1 × 0.55) × opacity`, then dust `source-over`; the context's composite op and alpha are restored after.
  - For `hollywood`: no grain or dust draws.
  - Two calls with `t` in the same 1/12 s draw the same grain frame; a call one step later draws a different one.
- [ ] **Step 2: Run** `npx vitest run src/utils/drawCinemaLook.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Read the picture at `width × LOOK_PROCESS_SCALE` (draw it scaled into a scratch canvas created with `willReadFrequently: true`, never `getImageData` on `ctx` itself), grade or glitch there, then draw the result back over `ctx` at `globalAlpha = opacity`, scaled up if needed. Grain: draw the 270×480 grain canvas scaled to `width × height`. Dust: draw `dustSpecs` with `source-over` at `opacity`. Start with `LOOK_PROCESS_SCALE = 1`.
- [ ] **Step 4: Run** the tests, `npx tsc -b` — expect PASS.
- [ ] **Step 5: Measure.** Write a throwaway page (not committed) in the worktree that calls `drawCinemaLook` on a 1080×1920 OffscreenCanvas holding a photo-like gradient, 80 times per look with `t` stepping 1/30 s, and prints ms/frame. Serve it with a temporary entry in the **main checkout's** `.claude/launch.json` (`npm --prefix .claude/worktrees/cinema-looks run dev -- --port 5189 --strictPort`), open it in the browser pane. Decision rule (an iPhone is about 3× slower than this Mac): if any look's average is over **12 ms/frame**, set `LOOK_PROCESS_SCALE = 0.5`. Record the numbers and the choice in the commit message body. Remove the page and the launch entry.
- [ ] **Step 6: Commit** — `feat: draw a film look over the picture on a 2D canvas`

### Task 3: Burn the look

**Files:**
- Modify: `src/utils/webcodecs/pictureEffects.ts` (`drawOpening`), `src/utils/openingLook.ts` (`openingFilterStages`), tests in `src/utils/openingLook.test.ts`, `src/utils/shotEncoding.test.ts`

**Interfaces:**
- Consumes: `drawCinemaLook` (Task 2), `lookOpacity`, `OpeningLook.grade` (Task 1).
- Produces: `drawOpening(ctx, t, look, width, height)` draws, in order, the graded picture (when `look.grade`) at `lookOpacity(t, look)`, then the bars. `openingFilterStages(look, input, output, width, height)` adds one approximate color stage before the bars when `look.grade` is set.

- [ ] **Step 1: Write the failing tests:**
  - `drawOpening` with `grade: 'mono'` calls `drawCinemaLook` (mock the module) with `(ctx, 'mono', t, lookOpacity(t, look), 1080, 1920)` before the bar rects; with `grade: null` it doesn't call it; after `openingEnd` neither.
  - `openingFilterStages` with a grade has a first stage `${input}…[lookgraded]` whose filter has `enable='lt(t,${openingEnd})'` and the bars' stages read `[lookgraded]`; without a grade the output is unchanged from today (keep the existing test).
  - Review Focus 5: in `shotEncoding.test.ts`, `burnRequest` for the first shot gives different keys for `grade: 'oldFilm'` and `grade: 'mono'`; for the second shot (`firstShotDuration: null`) the keys are equal.
- [ ] **Step 2: Run** `npx vitest run src/utils/openingLook.test.ts src/utils/webcodecs/pictureEffects.test.ts src/utils/shotEncoding.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** The ffmpeg stage approximates each color look with `eq`/`colorbalance`/`hue` (and `rgbashift` for `glitch`), active until `openingEnd` (a hard cut is acceptable on this last-resort path); no grain, dust or motion.
- [ ] **Step 4: Run** the tests, `npx vitest run`, `npx tsc -b` — expect PASS.
- [ ] **Step 5: Commit** — `feat: burn the picked film look under the opening bars`

### Task 4: Preview the look

**Files:**
- Create: `src/components/OpeningLookCanvas.tsx`, `src/components/OpeningLookCanvas.test.tsx`
- Modify: `src/components/SubtitleWorkflow.tsx`, `src/components/SubtitleWorkflow.module.css`

**Interfaces:**
- Consumes: `drawCinemaLook`, `lookOpacity`, `openingActive`, `useVideoFrameTime` (`src/hooks/useVideoFrameTime.ts`).
- Produces: `SubtitleWorkflow` prop `cinemaLook?: CinemaLook | null`, passed to its `withVideoType(…, cinemaLook)`. `OpeningLookCanvas({ video, opening }: { video: HTMLVideoElement | null; opening: OpeningLook | null })` — a 540×960 canvas, absolutely filling the preview, under the `.letterbox` divs and the subtitle overlay. On each video frame while `openingActive(t, opening)` and `opening.grade`, it draws the video frame then `drawCinemaLook(ctx, grade, t, lookOpacity(t, opening), 540, 960)`; otherwise it draws nothing and is hidden.

- [ ] **Step 1: Write the failing tests:**
  - `SubtitleWorkflow` with `videoType="A"` and `cinemaLook="oldFilm"`: while playing at t = 0 a `data-testid="opening-look"` canvas is present; paused, it isn't; at t past `openingEnd`, it isn't (Review Focus 4).
  - With `cinemaLook` absent, no canvas.
  - `OpeningLookCanvas` calls `drawCinemaLook` (mocked) with the frame's time and `lookOpacity`, and doesn't once the opening has ended.
- [ ] **Step 2: Run** `npx vitest run src/components/OpeningLookCanvas.test.tsx src/components/SubtitleWorkflow.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement**, rendering `<OpeningLookCanvas>` from `SubtitleWorkflow` next to the letterbox divs, only while `previewPlaying` (the same `opening` value they use).
- [ ] **Step 4: Run** the tests, `npx tsc -b` — expect PASS.
- [ ] **Step 5: Commit** — `feat: preview the picked film look while playing`

### Task 5: Pick it on the subtitle step, and receive it from Claude

**Files:**
- Modify: `server/mcp.ts`, `server/mcp.test.ts`, `server/inboxStore.ts`, `server/inboxStore.test.ts`, `shared/inbox.ts`, `src/types.ts`, `src/hooks/useScripts.ts`, `src/pages/ScriptEditPage.tsx`, `src/pages/ScriptEditPage.test.tsx`, `src/pages/FinalizePage.tsx`, `src/components/SubtitleWorkflow.tsx`, `src/components/SubtitleWorkflow.test.tsx`, `README.md`

**Interfaces:**
- Consumes: `CINEMA_LOOKS`, `CINEMA_LOOK_LABELS`, `CinemaLook` (Task 1); `withVideoType(…, look)`.
- Produces: `send_to_teleprompter` input `look: z.enum(['none', ...CINEMA_LOOKS]).optional()`; `InboxItem.look?: CinemaLook`; `Script.look?: CinemaLook`; `createScript(title, shots, caption?, oneTake?, japanese?, videoType?, look?: CinemaLook)`; `updateScript` accepts `look` (deleted when falsy); `SubtitleWorkflow` prop `onCinemaLookChange?: (look: CinemaLook | null) => void` (its `cinemaLook` prop comes from Task 4).

- [ ] **Step 1: Write the failing tests:**
  - MCP: `look: 'oldFilm'` with `type: 'A'` is stored on the item; `look: 'none'` stores no `look`; an unknown look is rejected by the schema; the reply text mentions the look's label (e.g. `・昔のフィルム`).
  - inboxStore: `add({ …, look: 'mono' })` keeps it; without it, the item has no `look` key.
  - ScriptEditPage: creating from an inbox item with `look: 'glitch'` makes a script with `look: 'glitch'`; editing an existing script keeps its `look`.
  - SubtitleWorkflow: with `videoType="B"` a group `role="group"` named `冒頭の色` shows なし and the five labels, `aria-pressed` on `cinemaLook`'s; tapping 白黒 calls `onCinemaLookChange('mono')`, tapping なし calls it with `null`; without `videoType` the group isn't there.
  - Review Focus 1: `SubtitleWorkflow` with `cinemaLook="mono"` and no `videoType` shows no `冒頭の色` group and, while playing at t = 0, no `opening-look` canvas; the same with `videoType="A"` shows both. (The `withVideoType` half is pinned in Task 1.)
- [ ] **Step 2: Run** the touched test files — expect FAIL.
- [ ] **Step 3: Implement.** MCP description: add a paragraph (Japanese) that `look` picks the opening's film look for a Type A/B script, one phrase per look as the spec's table, and when to pick which (`oldFilm` for a memory or something nostalgic, `nightBlue` for something serious, `glitch` for something chaotic or funny, `hollywood` for an everyday thing told big, `mono` for a quiet or dramatic moment); `none` or omitted = the bars alone; ignored without `type`. FinalizePage: pass `script?.look` to `withVideoType` (both memos) and to `SubtitleWorkflow`, and save changes with `updateScript(script.id, { look })`. SubtitleWorkflow: the group sits in the `videoType` branch under the existing Type hint, styled like the other `positionRow` buttons. README: one line on the look under the Type A/B entry.
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc -b` — expect PASS.
- [ ] **Step 5: Commit** — `feat: pick the opening's film look on the subtitle step, and take Claude's pick`

### Task 6: Record the look

**Files:**
- Modify: `shared/videoRecord.ts`, `src/utils/videoRecord.ts`, `src/utils/videoRecord.test.ts`, `server/mcp.ts` (`list_video_records` description)

**Interfaces:**
- Consumes: `CINEMA_LOOKS`, `OpeningLook.grade`.
- Produces: `effects.opening` schema `{ kind, at, look: z.enum(CINEMA_LOOKS).nullable().optional() }`; `buildVideoRecord` writes `look: burn.hook.opening.grade`.

- [ ] **Step 1: Write the failing tests:** a burn with `grade: 'nightBlue'` records `opening: { kind: 'letterbox', at, look: 'nightBlue' }` and round-trips through `parseVideoRecord`; a record without `look` (and the old `colorPop` one) still parses (Review Focus 3).
- [ ] **Step 2: Run** `npx vitest run src/utils/videoRecord.test.ts server/recordStore.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; the description adds `look（冒頭の色: hollywood/oldFilm/nightBlue/mono/glitch。nullは無し、項目が無いのは導入前）` inside `opening`.
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc -b`, `npm run build` — expect PASS.
- [ ] **Step 5: Commit** — `feat: record the opening's film look`

### Task 7: The routine's new prompt

**Files:**
- Create (main checkout, not committed): `/Users/yujioyama/Site/teleprompter/.claude/tiktok-routine-prompt-2026-11-03-v4.md`

- [ ] **Step 1:** Read the live prompt: RemoteTrigger `get` on `trig_01UYaa8o8j9W7XKrQ6nDQ3kL`, field `derived_state.prompt`. Save it as the starting text of the v4 file.
- [ ] **Step 2:** Edit only these places: (a) where the script is sent with `send_to_teleprompter`, add: for a Type A/B script pick one `look` (the five ids and when to use each, as the MCP description) and send it; tell the user which look was picked and why in one phrase. (b) The `effects` write-back line: add the look from `opening.look` (e.g. `look oldFilm`, or `look none`). (c) The Saturday comparison: add the look as a column next to the type.
- [ ] **Step 3:** Hand the file to the user to paste into the routine in the claude.ai UI. Do not update the trigger through the API. After they paste, `get` again and check `derived_state.prompt` matches the file.
