# Audio Normalization Feature Design

**Date:** 2026-05-09  
**Status:** Approved (revised after spec review x2)

## Overview

Add automatic audio loudness normalization to the recording pipeline so that videos exported for Instagram and TikTok have consistent, platform-standard volume levels. The feature is enabled by default and can be toggled off in Settings.

## Background

The Hollyland LARK M2 microphone records at a level that is noticeably quieter than other creators' videos. Instagram and TikTok both target -14 LUFS internally, so recordings that already arrive at -14 LUFS pass through unchanged while quieter recordings get boosted to match.

## Approach

Single-pass loudnorm via FFmpeg WASM (EBU R128). The video stream is stream-copied (no re-encode); only the audio stream is re-encoded to AAC with the normalization filter applied in the SAME single FFmpeg call as trim and faststart -- not as a separate subsequent pass. This adds minimal processing time while delivering social-media-standard loudness.

Target: -14 LUFS integrated, LRA 11 LU, true peak -1 dBTP.

## Architecture

### Affected files

| File | Change |
|------|--------|
| src/hooks/useSettings.ts | Add normalizeAudio: boolean (default true) |
| src/hooks/useRecorder.ts | Add normalizeAudio to ShotTrimSettings; pass it to remuxMp4() |
| src/pages/RecordPage.tsx | Pass normalizeAudio: globalSettings.normalizeAudio in startRecording() call |
| src/utils/remuxMp4.ts | Add normalize?: boolean to RemuxOptions; switch audio codec when enabled |
| src/pages/SettingsPage.tsx | Add audio section with toggle above the existing trim section |

### FFmpeg command change

Normalization is applied in the single combined FFmpeg pass (together with -ss, -t,
-movflags +faststart). It is NOT a separate second pass.

-shortest is REMOVED from both paths. The -t duration cap (set from keyframe
detection) already prevents the iOS audio-longer-than-video freeze, making -shortest
redundant. When normalize=true, removing -shortest also avoids the AAC encoder's
~23 ms delay causing premature audio truncation.

When normalize is false:
  [-ss KF_start] -i in.mp4 [-t duration] -c copy -movflags +faststart out.mp4

When normalize is true:
  [-ss KF_start] -i in.mp4 [-t duration]
    -c:v copy -c:a aac
    -af loudnorm=I=-14:LRA=11:TP=-1
    -movflags +faststart out.mp4

Important notes on arg ordering:
  - -af must appear AFTER -i in the args array (FFmpeg requires filters after input).
  - -shortest is absent in BOTH paths (see reasoning above).

### remuxMp4 function signature update

The RemuxOptions interface and destructuring both gain normalize:

  interface RemuxOptions {
    trim?: { start: number; end: number }
    normalize?: boolean   // NEW
  }

  export async function remuxMp4(
    blob: Blob,
    { trim, normalize }: RemuxOptions = {},   // destructure normalize
  ): Promise<{ blob: Blob; ok: boolean; error?: string }>

### Settings schema

interface AppSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
  normalizeAudio: boolean   // NEW -- default true
}

useSettings already merges stored values with DEFAULTS, so existing users without
this key stored will automatically get true.

### ShotTrimSettings update (useRecorder.ts)

interface ShotTrimSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
  normalizeAudio: boolean   // NEW
}

RecordPage.tsx constructs this object inline when calling startRecording(); it must
be updated to include normalizeAudio: globalSettings.normalizeAudio.

### webm path

When the browser records webm (non-iOS, e.g. desktop Chrome), useRecorder skips
remuxMp4 entirely. normalizeAudio is silently ignored in this path, consistent with
the existing behaviour for trimming ("webm: trimming not supported, silently ignored").
No user feedback change is needed.

### Settings UI

New section added above "自動トリミング" in SettingsPage:

  音声
  ----------------------------------------
  音量の自動調整                    [toggle]
  SNS投稿に最適な音量に自動調整します

## Data flow

  AppSettings.normalizeAudio
    => RecordPage passes it in startRecording(stream, { ..., normalizeAudio })
         => useRecorder calls remuxMp4(raw, { trim, normalize: shotSettings.normalizeAudio })
              => remuxMp4 builds a single ff.exec() call:
                 normalize=true:  -c:v copy -c:a aac -af loudnorm=I=-14:LRA=11:TP=-1
                 normalize=false: -c copy

## Error handling

If the single combined FFmpeg call fails (e.g. loudnorm filter unavailable in this
WASM build), the existing try/catch in remuxMp4 catches it and returns
{ ok: false, error: msg, blob: originalBlob }. The caller (useRecorder) sets
remuxOk=false, which the UI already surfaces to the user. No new error states needed.

## Out of scope

- Two-pass loudnorm (single-pass is sufficient for social media)
- Per-shot normalization toggle (global setting is enough)
- Normalization on the webm recording path (iOS-only feature)
- Visual loudness meter / before-after comparison
