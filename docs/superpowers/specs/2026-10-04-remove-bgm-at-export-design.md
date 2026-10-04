# Removing the BGM at the Export Step

**Date:** 2026-10-04
**Status:** Approved (brainstorming)

## Problem

Once a BGM is mixed — by tapping 次へ on the BGM step, or automatically
when the usual BGM is set in Settings — the user lands on the export step
with no visible way to drop it. The only route is to tap BGM in the wizard
indicator and then BGMなしで進む, which nothing on the export step hints at.
With the usual BGM the BGM step is never even seen, so "this one should
have no music" is hard to act on.

## Goal

On the export step, when the finished video has a BGM, show which track it
is and a **BGMを外す** button that switches the finished video to the
BGM-less one.

## Non-goals

- A 「なし」 row in the BGM picker, or deselecting a picked track by tapping
  it again.
- Re-adding a BGM from the export step. The wizard indicator's BGM step
  already does that.

## Design

### UI

Under the finished video on the export step, above 保存する:

```
BGM: <track title>   [BGMを外す]
```

Shown only while a BGM is mixed in. Tapping BGMを外す drops the mix: the
finished video falls back to the burned (or combined) video, so the
existing loudness effect re-runs (「音量を調整中...」, then the BGM-less
video). The BGM step stays marked completed, because no BGM is a valid
outcome of it.

### Data flow

- `MusicMixer`'s `onMixed` reports the track with the blob:
  `onMixed(mix: { blob: Blob; trackTitle: string } | null)`.
  BGMなしで進む still reports `null`.
- `FinalizePage` replaces `mixedBlob: Blob | null` with
  `mixed: { blob: Blob; trackTitle: string } | null`.
  `finalBlob = mixed?.blob ?? burnedBlob ?? combinedBlob`. Every
  `setMixedBlob(null)` becomes `setMixed(null)`.
- BGMを外す calls `setMixed(null)`. Nothing else changes: the
  loudness effect already keys on `finalBlob`, and `normalizeLoudness`
  caches per blob, so re-adding the same mix later doesn't redo the pass.

## Testing (`FinalizePage.test.tsx`)

- After mixing a track, the export step shows `BGM: <title>` and
  BGMを外す.
- Tapping BGMを外す re-runs loudness on the pre-BGM (burned) video, and
  保存する saves that BGM-less video.
- After BGMなしで進む, the export step shows neither.
- `MusicMixer.test.tsx`: `onMixed` is called with the blob and the track
  title.
