# Default BGM, Default Subtitle Position, Fewer Finalize Taps

**Date:** 2026-10-04
**Status:** Approved (brainstorming)

## Problem

Finishing a video takes more taps and waiting than it needs to:

1. **BGM is picked every time.** The user almost always uses Tokyo Lofi at
   the same volume, yet the BGM step makes them choose a genre, a track and
   a volume, then tap 次へ, on every video.
2. **英語字幕を生成 is a pointless tap.** The English cues are derived purely
   from the script text and trims; there is nothing to decide.
3. **The subtitle position is adjusted every time.** None of the three
   presets (上部 / 中央 / 下部) is where the user wants the subtitles, so
   every video needs 細かく調整. Long cues grow up and down from the anchor,
   so the right spot is one where both short and long cues sit well.
4. **Adding BGM after the burn is slow.** After 焼き込み, the finished video
   is read and rewritten twice: once by the BGM mix, once by the export
   step's loudness pass. Both only touch the audio, which the subtitles
   never change.

## Goal

With a default BGM set, finishing a video is: trim → 結合 → check the
subtitles (already generated, already at the usual position) → paste the
Japanese → 次へ → export. No BGM step stop, and the wait after 焼き込み is
one quick packet copy instead of two audio passes.

## Non-goals

- Automating the Japanese translation (Claude API). Considered and
  declined; the copy/paste flow stays.
- Pre-preparing audio when no default BGM is set (the no-BGM path is one
  loudness pass today and stays as is).
- Making the ffmpeg.wasm fallback path faster. Without WebCodecs the
  current sequential mix → loudness path is used unchanged.
- Cancelling the BGM mix (still not reported as freezing).

## Design

### 1. Settings

`AppSettings` (`src/hooks/useSettings.ts`) gains:

| key | type | default |
|---|---|---|
| `defaultBgmId` | `string \| null` | `'lofi-tokyo'` |
| `bgmVolume` | `number` (0–1) | `0.3` |
| `subtitlePosition` | `number` (0–100) | `SUBTITLE_POSITION_BOTTOM` |

A `defaultBgmId` that no longer matches a track in `MUSIC_TRACKS` is
treated as `null` (resolved in one helper, e.g. `defaultBgmTrack(settings)`).

`SettingsPage` gains two sections:

**BGM**
- いつものBGM: a `<select>` with なし plus every track, grouped by genre
  (`<optgroup>` using `GENRE_LABELS`), with a ▶ 試聴 / ■ 停止 button for the
  selected track.
- BGMの音量: a slider (0–1, step 0.05, shown as %), same as MusicPicker's.
  Disabled when いつものBGM is なし.

**字幕の位置**
- Two 9:16 preview frames side by side (短い字幕 / 長い字幕), each rendering
  `SubtitleOverlayPreview` with a fixed sample cue (English + Japanese) at
  `currentTime` 0, over a plain dark background.
  - The short sample is one line in each language.
  - The long sample reaches the 3-line maximum in both languages
    (`EN_STYLE.maxLines` / `JA_STYLE.maxLines`), verified by a test through
    `layoutCue`, so it shows the tallest box a real cue can produce.
- One slider (0–100, step 1) moves both, plus 上部 / 中央 / 下部 shortcut
  buttons that set the slider to the existing presets.
- Because the preview uses the same layout code as the burn-in, what the
  frames show is where the burned subtitles land.

### 2. Subtitle step

- **Auto-generate.** When `SubtitleWorkflow` mounts in stage `idle` with no
  cues, it runs today's generate logic immediately. The 📝 英語字幕を生成
  button is removed. If the script has no usable text, today's error is
  shown (the fix is still on the trim step).
- **Default position.** `FinalizePage` initializes `subtitleState.position`
  from `settings.subtitlePosition` instead of `SUBTITLE_POSITION_BOTTOM`.
  The per-video presets and 細かく調整 slider stay, for one-off tweaks.

### 3. BGM step passes itself

`MusicMixer` gets two new props:
- `initialTrackId` / `initialVolume`: from settings; the picker opens with
  them selected (and on that track's genre). Used every time the step is
  shown, so going back to it from export shows the usual BGM pre-selected.
- `autoMix: boolean`: when true, on mount it immediately runs the same
  path as 次へ with the initial track and volume. While it runs, the step
  shows only 「いつものBGM（<title>）を合成中…」 and a 別のBGMを選ぶ button.
  - Success → `onMixed` + `onNext`, exactly like 次へ.
  - 別のBGMを選ぶ → the in-flight result is discarded (bump `requestIdRef`,
    as 「BGMなしで進む」 does today) and the normal picker is shown.
  - Failure → the normal picker with today's error message.

`FinalizePage` sets `autoMix` only for the BGM step entered straight from a
successful burn while a default BGM is set (a `bgmAutoPending` flag set in
`onBurned`, cleared once the BGM step settles or the user navigates).
Re-entering the BGM step through `WizardSteps` never auto-mixes.

With `defaultBgmId` null nothing changes: the step opens with no track
selected, as today.

### 4. Pre-prepared final audio (WebCodecs only)

Subtitles change only the video; BGM and loudness change only the audio.
So the final audio can be built from `combinedBlob` while the user is still
on the subtitle step, and joined to the burned video afterwards.

**New module `src/utils/webcodecs/finalAudio.ts`:**
- `prepareFinalAudio(source: Blob, track: Blob, volume: number, normalize: boolean): Promise<Blob>`
  - decode `source`'s audio (`decodeAudioTrack`),
  - mix the BGM (the existing `renderMix`, refactored to take a decoded
    `AudioBuffer` so both the old and new paths share it),
  - if `normalize`, apply the loudness gain (`planLoudnessGain` +
    `applyGainWithLimiter`, the same steps as `normalizeLoudnessWebCodecs`,
    extracted into a shared helper),
  - encode once to an **audio-only M4A blob** (≈1 MB/min). Keeping the
    encoded audio instead of the float `AudioBuffer` (≈23 MB/min) matters on
    iPhone, where memory pressure already broke previews (issue #12).
- `joinVideoAndAudio(video: Blob, audio: Blob): Promise<Blob>` — writes an
  MP4 copying the video packets from `video` and the audio packets from
  `audio`, with no re-encode. Rejects if the two durations differ by more
  than 50 ms (a sign the burned video doesn't match the prepared audio).
  The M4A's AAC encoder delay (trimmed today via `aacEncoderDelay` and an
  edit list) must survive the packet copy, or the audio would start a few
  ms late; covered by the on-device sync check below.

**Wiring (`FinalizePage`, via a small `PreparedAudio` holder):**
- Started when the subtitle step is entered with a `combinedBlob`, a
  default BGM set and WebCodecs available. Keyed by
  `(combinedBlob, trackId, volume, normalize)`; a change of any key
  discards the old result. It starts at once, on entering the step: it
  uses only the audio decoder/encoder, and the background subtitle burns
  only begin after the Japanese is pasted, so in practice it finishes
  before any video encode starts.
- The BGM step's mix (auto or 次へ) goes through one function
  `mixForExport(video, trackId, volume)`:
  1. if a prepared result exists for exactly this key, await it and
     `joinVideoAndAudio(burnedBlob, prepared)`;
  2. otherwise, or if step 1 throws, today's `mixMusic`.
- When step 1 produced the blob and `normalize` was on, the export step
  must not normalize again: `normalizeLoudness.ts` gets
  `markLoudnessNormalized(blob)`, which seeds its per-blob cache with the
  blob itself, so the existing export effect resolves instantly.

Choosing a different track or volume on the BGM step, skipping BGM, or
having no WebCodecs all fall back to today's behaviour.

## Error handling

- Prepared-audio failure: logged with `console.warn`, then the old path.
  Never shown to the user.
- Auto-mix failure: the normal BGM picker with the existing error message.
- Settings read failure: existing `loadSettings` fallback to defaults.

## Testing

- `useSettings`: new defaults; old stored settings without the new keys get
  the defaults.
- `SettingsPage` (new test file): BGM select/volume persist; なし disables
  the volume slider; position slider and presets persist.
- Sample cues: the long sample lays out to 3 lines in both languages.
- `SubtitleWorkflow`: cues are generated on mount; the generate button is
  gone; the empty-text error still shows.
- `MusicMixer`: initial track/volume pre-selected; `autoMix` mixes and
  advances; 別のBGMを選ぶ discards the result and shows the picker; a failed
  auto-mix shows the picker with the error.
- `FinalizePage`: with a default BGM, burn → export without stopping on the
  BGM step; the subtitle position starts at the setting; with
  `defaultBgmId: null` the BGM step stops as today.
- `finalAudio` / `mixForExport`: matched key → join used and marked
  normalized; mismatched key or a join failure → `mixMusic`.
- On device (iPhone, WebCodecs): time 焼き込み完了 → 書き出し画面 before
  and after the change; check the audio is in sync and the BGM fades
  in/out at the right places. The simulator does not reproduce iPhone
  media behaviour, so this check is on a real device.
