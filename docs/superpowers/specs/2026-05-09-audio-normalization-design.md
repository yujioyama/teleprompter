# Audio Normalization Feature Design

**Date:** 2026-05-09  
**Status:** Approved  

## Overview

Add automatic audio loudness normalization to the recording pipeline so that videos exported for Instagram and TikTok have consistent, platform-standard volume levels. The feature is enabled by default and can be toggled off in Settings.

## Background

The Hollyland LARK M2 microphone records at a level that is noticeably quieter than other creators' videos. Instagram and TikTok both target -14 LUFS internally, so recordings that already arrive at -14 LUFS pass through unchanged while quieter recordings get boosted to match.

## Approach

Single-pass loudnorm via FFmpeg WASM (EBU R128). The video stream is stream-copied (no re-encode); only the audio stream is re-encoded to AAC with the normalization filter applied. This adds minimal processing time while delivering social-media-standard loudness.

Target: -14 LUFS integrated, LRA 11 LU, true peak -1 dBTP.

## Architecture

### Affected files

| File | Change |
|------|--------|
| src/hooks/useSettings.ts | Add normalizeAudio: boolean (default true) |
| src/utils/remuxMp4.ts | Add normalize?: boolean to RemuxOptions; switch audio codec when enabled |
| src/hooks/useRecorder.ts | Pass normalizeAudio from shot settings to remuxMp4() |
| src/pages/SettingsPage.tsx | Add audio section with toggle above the existing trim section |

### FFmpeg command change

When normalize is false (current behaviour):
  -c copy

When normalize is true:
  -c:v copy  -c:a aac  -af loudnorm=I=-14:LRA=11:TP=-1

The rest of the args (-movflags +faststart, -shortest, optional -ss/-t) are unchanged.

### Settings schema

interface AppSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
  normalizeAudio: boolean   // NEW -- default true
}

useSettings already merges stored values with DEFAULTS, so existing users without
this key stored will automatically get true.

### Settings UI

New section added above "自動トリミング" in SettingsPage:

  音声
  ----------------------------------------
  音量の自動調整                    [toggle]
  SNS投稿に最適な音量に自動調整します

## Data flow

  RecordPage
    => useRecorder.startRecording(stream, shotSettings)
         => remuxMp4(raw, { trim, normalize: shotSettings.normalizeAudio })
              => ff.exec([..., '-c:v', 'copy', '-c:a', 'aac',
                          '-af', 'loudnorm=I=-14:LRA=11:TP=-1', ...])

## Error handling

loudnorm filter failure causes ff.exec() to throw, which is caught by the existing
try/catch in remuxMp4. The function returns { ok: false, error: msg } and falls back
to the original blob -- same as today's remux error handling. No new error states
or UI changes are needed for the error path.

## Out of scope

- Two-pass loudnorm (single-pass is sufficient for social media)
- Per-shot normalization toggle (global setting is enough)
- Visual loudness meter / before-after comparison
