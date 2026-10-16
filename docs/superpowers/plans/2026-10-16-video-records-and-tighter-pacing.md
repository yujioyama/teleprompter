# Video Records and Tighter Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighter default cuts, a per-shot 間を残す switch and a tight last shot. Each saved video sends a record of how it was made, which Claude's connector can read.

**Architecture:** Trim resolution stays in `src/utils/shotTrim.ts` (pure, tested). The finalize page captures the inputs of each stage as it runs. On 保存する it builds a `VideoRecord` (pure builder in `src/utils/videoRecord.ts`) and posts it to `/api/records`. That endpoint stores it in Upstash (`server/recordStore.ts`), and the MCP server exposes it read-only.

**Tech Stack:** React 18 + TS, Vitest, Vercel functions, Upstash Redis, `@modelcontextprotocol/sdk`, zod.

**Spec:** `docs/superpowers/specs/2026-10-16-video-records-and-tighter-pacing-design.md`

## Global Constraints

- Defaults: `trimPaddingStart` 0.1, `trimPaddingEnd` 0.2, `lastShotPaddingEnd` 0.1. The 間を残す end padding is 0.4 (constant). The last shot's auto-trim is at least 1.2 s long.
- Sliders 前に残す時間 / 後ろに残す時間: min 0, max 2.0, step 0.05, value shown with `toFixed(2)`.
- Record key `record:<scriptId>`, TTL 120 days. One record per script, and a later save replaces it.
- Sending a record never blocks or fails the save. Nothing is sent when `inboxKey === ''`.
- UI copy: 「このショットの後に間を残す」, 「最後のショットの後ろに残す時間」.
- Test runs: `npx vitest run <files>`. Types: `npx tsc -b` (not `--noEmit -p .`).

## Review Focus

- A saved 結合 from before this change (no `trim` stored): its record has `trim: null` and saving doesn't throw. (Task 4 test)
- Settings changed after the burn but before 保存する: the record shows the burn's hook, not the current settings. (Task 5 builder test: the builder takes the captured inputs only)
- Last shot shorter than 1.2 s even at full length: the end is capped at the clip's duration by the existing `clampTrimRange`. (Task 1 test)
- Toggling 間を残す on a shot the user trimmed by hand: the hand trim stays. (Task 2, via the `trimEdited` rule)
- A one-shot video: it is first and last at once, so it gets the first-shot start padding and the last-shot end padding. (Task 1 test)

---

### Task 1: Trim settings: defaults, last shot, keepPause, migration

**Files:**
- Modify: `src/hooks/useSettings.ts`, `src/utils/shotTrim.ts`, `src/types.ts`, `src/utils/scriptBackup.ts`, `src/pages/SettingsPage.tsx`
- Test: `src/hooks/useSettings.test.ts`, `src/utils/shotTrim.test.ts`, `src/utils/scriptBackup.test.ts`

**Interfaces:**
- Produces:
  - `AppSettings.lastShotPaddingEnd: number`
  - `Shot.keepPause?: boolean`
  - `export const PAUSE_PADDING_END = 0.4`
  - `export const LAST_SHOT_MIN_LENGTH = 1.2`
  - `resolveShotTrimSettings(shot, global, isFirstShot = false, isLastShot = false): ShotTrimSettings`. `ShotTrimSettings` gains `minLength: number` (1.2 for the last shot, else 0).
  - `autoTrimOf(region: SpeechRegion, trim: ShotTrimSettings): SpeechBounds | null`, in `shotTrim.ts`. It returns `speechBoundsFor(...)` with `end` raised to `start + trim.minLength` if shorter (the caller clamps to duration).

- [ ] Tests in `shotTrim.test.ts`:
  - middle shot uses 0.1/0.2 from defaults
  - last shot uses `lastShotPaddingEnd`
  - one-shot video gets first start + last end
  - `keepPause` gives end 0.4 even on the last shot and even over `shot.trimPaddingEnd`
  - `autoTrimOf` raises a 0.6 s bound to 1.2 s for the last shot and leaves a middle shot alone
- [ ] Tests in `useSettings.test.ts` (`migrateSettings`):
  - stored `{trimPaddingStart: 0.3, trimPaddingEnd: 0.4}` without `lastShotPaddingEnd` → 0.1/0.2
  - stored 0.5 stays 0.5
  - stored with `lastShotPaddingEnd` present: 0.3 stays 0.3
- [ ] Test in `scriptBackup.test.ts`: a shot with `keepPause: true` round-trips, and `keepPause: 'x'` is rejected.
- [ ] Run, see the failures, implement, and run until green. Add the 「最後のショットの後ろに残す時間」 slider (0–0.5, step 0.05) after the first-shot slider. Change the two global sliders to min 0, step 0.05, `toFixed(2)`.
- [ ] Commit `feat: tighter default cuts, a last-shot end padding and a per-shot pause`.

### Task 2: Finalize trim step uses the new rules and the 間を残す switch

**Files:**
- Modify: `src/pages/FinalizePage.tsx`, `src/pages/FinalizePage.module.css`
- Test: `src/pages/FinalizePage.test.tsx`

**Interfaces:**
- Consumes: Task 1 `resolveShotTrimSettings(..., isLastShot)`, `autoTrimOf`, `Shot.keepPause`.
- `ShotEntry` gains `speech: SpeechRegion | null | undefined` (undefined = not detected yet). Every place that called `speechBoundsFor(speech, pads...)` calls `autoTrimOf(speech, trim)` instead. The last shot is the last shot with a take (mirrors `firstShotId`).

- [ ] Test: with a stored speech analysis, the switch 「このショットの後に間を残す」 for the selected shot calls `updateScript` with that shot's `keepPause: true`, and the entry's trim end moves to speech end + 0.4. Follow the existing FinalizePage test setup.
- [ ] Implement: a checkbox under the ShotTrimmer. On change, `updateScript(script.id, { shots })` with the flag. Then recompute that entry via `setAutoTrim(shotId, autoTrimOf(entry.speech, resolveShotTrimSettings(updatedShot, settings, isFirst, isLast)))`. The existing `trimEdited` rule keeps hand trims.
- [ ] Run the tests and `npx tsc -b`. Commit `feat: 間を残す switch per shot in the trim step`.

### Task 3: Record store, API and connector tool (server)

**Files:**
- Create: `shared/videoRecord.ts` (the `VideoRecord` type from the spec, plus `parseVideoRecord(value: unknown): VideoRecord | null` using zod), `server/recordStore.ts`, `server/recordsApi.ts`, `api/records.ts`
- Modify: `server/mcp.ts`, `api/mcp.ts`
- Test: `server/recordStore.test.ts`, `server/recordsApi.test.ts`, `server/mcp.test.ts`

**Interfaces:**
- `RecordStore { put(record: VideoRecord): Promise<void>; list(since?: string): Promise<VideoRecord[]> }`. `list` returns records newest `savedAt` first, filtered `savedAt >= since`, and lists keys by SCAN like the inbox store. `RECORD_TTL_SECONDS = 120 * 24 * 60 * 60`.
- `handleRecordsRequest(request, getStore)`: POST only (405 otherwise), `withAuthedJson`. Returns 400 when `parseVideoRecord` fails and 204 on success.
- `McpDeps.records: () => RecordStore`. `RECORDS_TOOL_NAME = 'list_video_records'`, input `{ since?: string }` (ISO date). It returns `JSON.stringify(records, null, 2)` as text, and the text `記録はまだありません` when there are none.

- [ ] Tests:
  - store put/list ordering, `since` filter and TTL set
  - API: 401 wrong key, 405 GET, 400 bad body, 204 and stored on good body
  - MCP: `tools/list` includes `list_video_records`, and a call returns the stored records
- [ ] Implement. Commit `feat: store video records and list them through the connector`.

### Task 4: Combine stores its trim record

**Files:**
- Modify: `src/utils/finalizeProgressStore.ts`, `src/pages/FinalizePage.tsx`
- Test: `src/utils/finalizeProgressStore.test.ts` (if present, else FinalizePage test)

**Interfaces:**
- `TrimRecord = VideoRecord['effects']['trim']` (non-null part). `SavedCombined.trim?: TrimRecord`.
- FinalizePage keeps `combinedTrim: TrimRecord | null` in state. `handleCombine` sets it from `settings` (`firstShotPaddingStart`, `trimPaddingStart`, `trimPaddingEnd`, `lastShotPaddingEnd`) and the count of `availableEntries` whose shot has `keepPause`, and saves it with the 結合. Restoring a saved 結合 sets it from `combined.trim ?? null`.

- [ ] Test: a saved 結合 without `trim` loads with `combinedTrim` null (no throw). Saving a new 結合 stores `trim`.
- [ ] Implement and commit `feat: remember how each 結合 was trimmed`.

### Task 5: Build and send the record on 保存する

**Files:**
- Create: `src/utils/videoRecord.ts`, `src/utils/records.ts` (client `postVideoRecord(key: string, record: VideoRecord): Promise<void>`, same auth as `src/utils/inbox.ts`)
- Modify: `src/pages/FinalizePage.tsx`
- Test: `src/utils/videoRecord.test.ts`, `src/utils/records.test.ts`

**Interfaces:**
- `buildVideoRecord(input: { script: Script; savedAt: string; durationSec: number; shotCount: number; burn: BurnInputs | null; mix: MixInputs | null; voicePreset: VoicePreset; trim: TrimRecord | null }): VideoRecord`
  - `BurnInputs = { hook: HookOptions; cues: SubtitleCue[]; position: number; durations: number[] }`
  - `MixInputs = { trackId: string; title: string; volume: number }`
  - `hookLine` = `stripStickers(stripEmphasis(script.shots[0].text))`.
  - `sticker`: if `burn` and `hook.sticker !== 'off'` and `stickerOf(styleCues(cues, durations[0], hook.style))` is set, then `{emoji, placement, motion}`, else null.
  - `fairies`: from `fairiesFromSubtitles(cues, durations, hook, position)` (cameo emojis, finale present), `enabled: hook.fairies ?? true`. Without a burn: `{enabled: false, cameoEmojis: [], finale: false}`.
  - `zoom`: `hook.punchIn` mapped to `{scale: zoom, direction, at, duration}`, or null. Without a burn, `zoom` is null and `hookStyle` false (they are drawn by the burn).
  - `subtitles`: `{burned: burn !== null, japanese: burn?.cues.some(c => c.ja?.trim()) ?? false}`.
- FinalizePage:
  - In the `burn` prop, store `{hook, cues, position, durations: combinedClips.map(c => c.end - c.start)}` in a ref. `onBurned` copies it into `burnInputs` state.
  - In `mix`, store `{trackId: track.id, title: track.title, volume}` in a ref. `onMixed` sets `mixInputs` from it (or null when the mix is removed).
  - Clear both wherever `burnedBlob`/`mixed` are cleared (`goToStep`, `handleCombine`, BGMを外す).
  - `voicePreset` is the current setting: the export effect re-runs on it.
  - `handleSaveFinal`: if `settings.inboxKey`, build the record. `durationSec` comes from `probeVideoDuration(exportBlob)`. Fire `postVideoRecord(...).catch(console.warn)` without awaiting, then share as before.
- [ ] Tests:
  - builder: sticker/fairies from cues, no-burn case, `trim` null passes through
  - the builder is fed only captured inputs (the hook in `burn` differs from defaults → the record shows the burn's)
  - `postVideoRecord` sends `Authorization: Bearer` and a JSON body to `/api/records` and throws on non-OK
  - FinalizePage: 保存する with no `inboxKey` sends nothing
- [ ] Implement, run the whole suite (`npx vitest run`), `npx tsc -b` and `npm run lint`. Commit `feat: send a record of how each saved video was made`.

### Task 6: Ship

- [ ] Verify the trim step in the browser preview: the switch, the new slider.
- [ ] Push, open the PR, wait for CI (build + preview), merge with `gh pr merge --merge`.
- [ ] Draft the routine change (spec "Routine change") and show it to the user before applying.
