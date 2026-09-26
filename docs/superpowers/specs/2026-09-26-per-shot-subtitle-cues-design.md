# Per-shot subtitle cues (replace whole-video Whisper transcription)

## Problem

Subtitle generation currently runs Whisper (`transcribeSpeech`, `src/utils/transcribeSpeech.ts`) against the *already-combined* video blob (`SubtitleWorkflow.tsx:85`). Whisper re-segments speech on its own (pauses, 30s windows), so cue boundaries never align with the original per-shot cut points, and results depend on ASR accuracy even though the exact script text for every shot is already known and stored (`Shot.text`, `src/types.ts:3`; carried into `ShotEntry.text`, `src/pages/FinalizePage.tsx:16`).

## Decision

Generate one subtitle cue per shot directly from its known script text, timed by the shot's trimmed duration, instead of transcribing the combined video's audio.

- **Text source**: `ShotEntry.text` (the teleprompter script for that shot), used verbatim. No ASR.
- **Granularity**: one cue per shot, spanning that shot's entire on-screen duration in the combined video, even if the shot's text is multiple sentences. (Rejected: splitting a shot's text into per-sentence cues distributed proportionally by duration — adds complexity and would drift from actual speech pacing since no timing signal exists to anchor it.)
- **Timing**: cue `start`/`end` are computed by accumulating each shot's trimmed duration in combine order — the same order and same trim values (`trimStart`, `trimEnd || duration`) already used by `handleCombine` (`FinalizePage.tsx:159-164`) to build the combined video via `concatVideos`. This guarantees offsets line up with the actual combined output without any ffprobe/re-detection step.
- **Empty text**: a shot with blank/whitespace-only text produces no cue, but its duration still advances the running offset so later shots stay aligned.
- **Whisper code**: `transcribeSpeech.ts` / `whisperWorker.ts` are left in place, unused. Not deleted (may be reused later); just no longer called from this flow.
- **Translation / editing / burn-in**: unchanged. `SubtitleCue` shape (`id, start, end, en, ja`) is unchanged, so `SubtitleEditor`, the Claude-prompt translation flow, and `burnSubtitles` all keep working as-is.

## Changes

### `src/utils/subtitleCues.ts`
Add:
```ts
export interface ShotCueInput {
  text: string
  duration: number
}

export function cuesFromShotEntries(entries: ShotCueInput[]): SubtitleCue[]
```
Walks `entries` in order, accumulating `duration` into a running offset; emits a cue `{ id, start: offset, end: offset + duration, en: text.trim(), ja: null }` for each entry whose trimmed text is non-empty; always advances the offset regardless.

### `src/pages/FinalizePage.tsx`
In `handleCombine`, alongside building `normalized` from `availableEntries`, also build:
```ts
const shotCueInputs = availableEntries.map(e => ({
  text: e.text,
  duration: (e.trimEnd || e.duration) - e.trimStart,
}))
```
Store in new state `shotCueInputs` (set together with `combinedBlob`/`combinedUrl` on success, and left stale-but-unused otherwise — same lifecycle as `combinedBlob`). Pass `shotCueInputs` as a new prop to `<SubtitleWorkflow>`.

### `src/components/SubtitleWorkflow.tsx`
- Replace the `transcribeSpeech` import with `cuesFromShotEntries` from `subtitleCues`.
- Add `shotCueInputs: ShotCueInput[]` to `SubtitleWorkflowProps`.
- `handleGenerate` becomes synchronous: `patch({ cues: cuesFromShotEntries(shotCueInputs), stage: 'reviewing' })`. Drop the try/catch (pure computation, cannot throw) and the now-inaccurate "初回はモデルのダウンロードが入ります" transcribing message; the `'transcribing'` stage is no longer entered.
- Leave everything from `handleEditEn` downward (translation, paste, preview, burn-in) untouched.

## Out of scope

- Deleting/cleaning up `transcribeSpeech.ts` / `whisperWorker.ts` (explicitly kept per user decision).
- Any per-sentence splitting within a shot.
- Re-running Whisper as a fallback when a shot's text is blank.
