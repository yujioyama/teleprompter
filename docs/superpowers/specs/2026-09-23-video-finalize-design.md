# Video Finalize (Combine + Bilingual Subtitles + BGM) Design

**Date:** 2026-09-23
**Status:** Approved (brainstorming)

## Overview

Add a "仕上げ" (Finalize) pipeline that runs after all shots for a script have
been recorded. It combines the individually-recorded shot videos into one
video, lets the user auto-generate English subtitles, hand them off to Claude
(outside the app) for Japanese translation, paste the translation back in,
burn both languages into the video, mix in a bundled background-music track,
and export/share the final result using the existing save flow.

## Background

Recording moved entirely to a native companion app
(`teleprompter-cam://record`) in a recent change. Each shot's video is
brought back into the PWA only transiently — via
`useRecorder.importFile()` — trimmed/remuxed/normalized, then shared or
downloaded to the camera roll and discarded (`reset()`). There is currently
no persistent video storage in the app and no way to assemble a final,
multi-shot video with captions and music. This feature adds that missing
"last mile" step.

## Approach

1. Persist each shot's processed video Blob into IndexedDB as it's saved,
   so the Finalize screen has everything it needs without re-importing.
2. A new step-based `FinalizePage`, reached from the existing "撮影完了"
   screen, that: lets the user fine-trim + preview shot transitions, combines
   clips with FFmpeg, runs on-device Whisper speech recognition for English
   captions, generates a ready-to-paste Claude prompt, accepts the pasted
   Japanese translation, burns both languages into the video as image
   overlays, mixes in a chosen bundled BGM track, and hands the result to the
   existing share/download flow.
3. All processing stays client-side (FFmpeg WASM + a WASM speech-recognition
   model), consistent with the app's no-backend, offline-friendly PWA design.

## Architecture

### Affected / new files

| File | Change |
|------|--------|
| `src/hooks/useShotVideoStore.ts` | **New.** IndexedDB wrapper: `save(scriptId, shotId, blob)`, `list(scriptId)`, `remove(scriptId, shotId)`, `clear(scriptId)`. |
| `src/pages/RecordPage.tsx` | `handleSaveAndNext` also calls `useShotVideoStore.save()` with the processed blob before advancing. Skipped shots (`handleSkipAndNext`) are not saved. "撮影完了" screen gets a new "🎬 動画を仕上げる" button routing to `/scripts/:id/finalize`. |
| `src/pages/FinalizePage.tsx` + `.module.css` | **New.** Step-based screen (Trim & Combine → English captions → Japanese via Claude → Preview & BGM → Export). Owns the pipeline state machine. |
| `src/components/ShotTrimmer.tsx` + `.module.css` | **New.** Per-shot preview player with draggable start/end handles on a timeline, live seconds readout, and an adjacent-shot "つなぎ目を確認" transition preview. |
| `src/components/SubtitleEditor.tsx` + `.module.css` | **New.** Editable numbered cue list (used for both the English-review step and the Japanese-paste step). |
| `src/components/MusicPicker.tsx` + `.module.css` | **New.** Genre-grouped track list with preview playback, selection, and a volume slider. |
| `src/utils/trimAndNormalizeShot.ts` | **New.** Re-encodes a single shot to a consistent format (H.264/AAC, fixed resolution) at the user-adjusted trim bounds, so all clips concat cleanly and cuts are frame-accurate. |
| `src/utils/concatVideos.ts` | **New.** Builds the FFmpeg concat-demuxer file list and runs `-f concat -safe 0 -i list.txt -c copy` over the already-normalized clips. |
| `src/utils/transcribeSpeech.ts` | **New.** Extracts audio from the combined video and drives the Whisper worker to produce timestamped `SubtitleCue[]`. |
| `src/workers/whisperWorker.ts` | **New.** Web Worker hosting the `@huggingface/transformers` Whisper pipeline (keeps the ~40–150MB model load and inference off the main thread). |
| `src/utils/subtitleCues.ts` | **New.** `SubtitleCue` type, `buildClaudePrompt(cues)`, `parseJapanesePaste(text, cues)` (numbered-line matching + mismatch detection). |
| `src/utils/burnSubtitles.ts` | **New.** Renders one transparent PNG per cue via `<canvas>` (JA line + EN line, position-aware) and builds the chained FFmpeg `overlay` filtergraph with `enable='between(t,start,end)'` per cue. |
| `src/utils/mixMusic.ts` | **New.** Loops/trims the chosen track to the final video's duration, applies short fade-in/out, and mixes it with the narration audio via `amix` at the chosen volume (video stream is copied, not re-encoded). |
| `src/data/musicTracks.ts` | **New.** Track metadata: `{ id, title, genre, credit, license, file }`. |
| `public/music/*.mp3` | **New.** 20 bundled tracks, 4 genres × 5 tracks (Lo-fi/Chill, Pop/Upbeat, Emotional/Cinematic, Corporate/Motivational), sourced from CC0 / attribution-free libraries at implementation time and recorded in `musicTracks.ts`. |
| `src/types.ts` | Add `SubtitleCue` and `MusicTrack` types (or split into a new `src/types/finalize.ts` if `types.ts` gets crowded). |
| `src/App.tsx` | Add route `/scripts/:id/finalize` → `FinalizePage`. |
| `package.json` | Add `@huggingface/transformers` dependency. Verify exact package name/version at implementation time (the Whisper-in-browser ecosystem has moved between `@xenova/transformers` and `@huggingface/transformers`). |

### Data model

```ts
interface SubtitleCue {
  id: string
  start: number   // seconds, relative to the combined video
  end: number
  en: string
  ja: string | null
}

interface MusicTrack {
  id: string
  title: string
  genre: 'lofi' | 'pop' | 'cinematic' | 'corporate'
  credit: string
  file: string    // path under public/music/
}
```

### IndexedDB shot store

One object store, key `${scriptId}:${shotId}`, value the processed `Blob`
plus `updatedAt`. `RecordPage.handleSaveAndNext` writes to it right after a
successful `shareOrDownload()`. Re-saving the same shot (retake) overwrites
the existing entry. Nothing is deleted automatically; `FinalizePage` offers
an explicit "元のショット動画を削除" action after a successful export, since
these blobs can be sizable on a storage-constrained phone.

### FinalizePage pipeline

**Step 1 — Trim & Combine**
- Loads all stored shots for the script (`useShotVideoStore.list`), in
  script order.
- Each shot renders in `ShotTrimmer`: play the clip, drag the start/end
  handles on a timeline bar (same interaction language as the existing
  padding sliders — numeric seconds shown live while dragging), and tap
  "つなぎ目を確認" to play the trimmed-out tail of this clip back-to-back
  with the trimmed-in head of the next clip (pure client-side playback, no
  FFmpeg needed for this preview).
- "結合する" runs, per shot: `trimAndNormalizeShot` (re-encode at the
  adjusted bounds to a fixed H.264/AAC/resolution profile — re-encoding here,
  rather than stream-copy, is what makes the cut frame-accurate and
  guarantees every clip matches for the next step), then `concatVideos`
  (concat demuxer, `-c copy`, fast since all inputs now match).
- Progress UI reuses the existing `remuxing`-style spinner pattern from
  `RecordPage`.

**Step 2 — English captions**
- `transcribeSpeech` extracts the combined video's audio and runs it through
  the Whisper worker with chunked timestamps, returning `SubtitleCue[]`
  (`ja: null` initially).
- Rendered in `SubtitleEditor` as an editable numbered list; the user can
  fix misrecognitions here before anything is sent out. Whisper model
  choice: an English-only small model (e.g. `whisper-tiny.en`, ~40MB) as the
  default, since the app expects the spoken track to be in English (matching
  the "generate English captions, translate to Japanese" workflow the user
  described); fall back to `whisper-base.en` if accuracy is unsatisfactory in
  practice.

**Step 3 — Japanese via Claude**
- "Claude用プロンプトをコピー" copies a single block combining a fixed
  instruction (translate to natural spoken-style Japanese subtitles, keep
  numbering, reply with only "N. 日本語" lines, no preamble) with the
  numbered English cues.
- The user pastes Claude's reply into a textarea. `parseJapanesePaste` splits
  on `^\s*(\d+)\.\s*(.+)$`, matches by number back onto `cues[n-1].ja`. A
  count/number mismatch is surfaced as an inline error explaining what's
  missing rather than silently applying a partial match.
- Japanese text is editable in the same `SubtitleEditor` component.

**Step 4 — Preview & BGM**
- Subtitle vertical position: three-way choice (上部 / 中央 / 下部), applied
  as the overlay's Y coordinate at burn time — not stored per-cue.
- `MusicPicker`: tracks grouped by genre, tap to preview, volume slider.

**Step 5 — Export**
- `burnSubtitles` then `mixMusic` run in sequence on the combined video,
  producing the final MP4.
- Output goes through the existing `shareOrDownload`-style share sheet /
  download fallback already used elsewhere in the app.
- After a successful export, offer to clear this script's stored shot videos
  from IndexedDB.

### Subtitle burn-in mechanics

Text is rendered to PNGs via `<canvas>` rather than FFmpeg's `drawtext` /
`subtitles` filters, to sidestep CJK font/libass availability questions in
the FFmpeg WASM build and to get full control over bilingual layout (Japanese
line bold/larger above, English line smaller below, rounded semi-transparent
background box). One transparent PNG per cue is written into the FFmpeg FS
and composited with a chained `overlay` filtergraph:

```
[0:v][ov1]overlay=x=(W-w)/2:y=Y:enable='between(t,S1,E1)'[v1];
[v1][ov2]overlay=x=(W-w)/2:y=Y:enable='between(t,S2,E2)'[v2];
...
```

`Y` is derived from the Step 4 position choice. This is evaluated against
the ffmpeg.wasm build's practical filtergraph-length limits during
implementation; if a script's cue count makes one long chain too slow, the
fallback is batching the overlay pass over multiple FFmpeg calls.

### Music mixing

```
ffmpeg -i final_with_subs.mp4 -i track.mp3 -filter_complex \
  "[1:a]aloop=loop=-1:size=2e9,atrim=0:DURATION,afade=t=in:d=1,afade=t=out:st=DURATION-1:d=1,volume=USER_VOL[bgm]; \
   [0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac out.mp4
```

Video stream is copied (no re-encode); only audio is mixed and re-encoded,
matching the existing normalization pass's pattern of cheap video-copy +
audio-only work.

## Error handling

- **Whisper transcription fails / model fails to load**: surface an inline
  error in Step 2 with a retry button; the user can still proceed manually by
  typing English cues from scratch if they choose (not blocking).
- **Trim bounds invalid** (start ≥ end, or shorter than a minimum clip
  length): `ShotTrimmer` clamps the drag and disables "結合する" until valid.
- **Concat fails** (e.g. a clip's re-encode produced an incompatible
  stream): fall back to a slower `concat` filter (re-encoding) instead of
  the concat demuxer, mirroring the existing `remuxMp4` fallback-on-failure
  pattern (return `{ ok: false, error }` rather than throwing).
- **Japanese paste line-count mismatch**: block applying the paste, show
  which cue numbers are missing/extra, let the user fix and re-paste.
- **BGM mix / burn-in FFmpeg failure**: same pattern as `remuxMp4` — catch,
  report `ok: false` with the error message, keep the pre-failure video
  available so the user doesn't lose the combine/subtitle work already done.

## Out of scope

- Automatic loudness-based ducking of BGM under narration (fixed user-set
  volume is enough for v1).
- Freeform subtitle positioning/drag, custom fonts/colors (fixed style,
  3-way vertical position only).
- Multi-language support beyond English source / Japanese target.
- User-uploaded custom BGM (bundled tracks only for v1).
- Automatic re-transcription if the user edits trim bounds after Step 2
  (re-running Step 1 after Step 2 requires re-running Step 2 as well — the
  UI should treat later steps as invalidated if the user goes back and
  changes the combined video).
- Keeping the final exported video in the app after export (it goes through
  the existing share/download flow only, same as individual shots today).
