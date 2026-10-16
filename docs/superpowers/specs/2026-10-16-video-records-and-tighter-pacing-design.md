# Video Records for the Weekly Analysis, and Tighter Pacing Between Shots

**Date:** 2026-10-16
**Status:** Approved (brainstorming, 2026-10-16)

## Why

The user's videos are judged by a cloud routine ("TikTok台本ネタ出し"),
not by the app. Every Saturday it reads TikTok Studio, writes views, likes,
comments and new followers into the matching Obsidian file in
`TikTok Scripts/` (matched by the hook's first line and the posting date),
and writes a weekly analysis. The biggest problem it tracks is the drop-off
in the first 2 seconds (baseline 2026-10-08: almost everyone gone at 0:02).

The app keeps changing how a video opens: zoom in/out, zoom speed, sticker
placement and motion, fairies, BGM, voice preset. The routine cannot tell
which video used what. Its prompt even says "if you can't tell which video
changed, ask". So the app's experiments can't be judged.

Separately, pacing: auto-trim leaves 0.3 s before and 0.4 s after each
shot's speech, so every cut has about 0.7 s of silence, and the video ends
on 0.4 s of silence, which weakens the loop back to the start.

## Goals

1. **Video records.** Each time a finished video is saved, the app sends
   the server a record of how it was made. The Claude connector gets a
   read-only tool, so the Saturday routine can read the records, write
   them into the Obsidian script files and compare videos by effect.
2. **Tighter cuts.** Shots after the first start and end closer to the
   speech by default.
3. **Per-shot pause.** In the finalize trim step, each shot has a
   「間を残す」 switch. When it's on, that shot keeps a longer silence after
   its speech. This is for intentional pauses, such as before a punchline.
   Default off.
4. **Tight ending.** The last shot gets its own end padding, like the
   first shot's start padding, so the video ends right after the last
   line.

## Non-goals

- **Instagram numbers.** The routine reads TikTok only. The records don't
  depend on the platform, but nothing here reads Instagram.
- **Analysis in the app.** No charts, no entering numbers in the app. The
  routine already does the analysis.
- **Mid-video zoom changes** (alternating 1.0x/1.1x per cut). Possibly
  later, once the records show whether the opening changes work.
- **Changing the routine without asking.** The routine's prompt must
  change too (see "Routine change"), but the user approves that edit
  separately. It is not part of the app's PR.

## Anti-goals

- Saving the video must never fail or wait because the record couldn't be
  sent.
- A record must describe the video that was actually saved, not whatever
  the settings say at the moment of saving. For example, settings can be
  changed after the subtitles were burned and before 保存する is tapped.
- Tightening must not cut word endings. Also, the intentional pauses have
  to stay possible (that's why goal 3 exists).

## 1. Video records

### When

When 保存する in the export step is tapped (`handleSaveFinal` in
`FinalizePage.tsx`). The record is sent whether or not the share sheet is
completed or cancelled. Tapping 保存する means "this is the version". It is
fire-and-forget: errors are logged, the save goes on.

If the device has no 受け取り用キー (`inboxKey === ''`), nothing is sent.

### What

One record per script. Saving again replaces the record, because the last
saved version is the one that gets posted.

```ts
interface VideoRecord {
  scriptId: string
  title: string
  /** Line 1 as the viewer hears it: no *emphasis* markers, no emoji. Matches the Obsidian `hook`. */
  hookLine: string
  savedAt: string          // ISO
  durationSec: number      // the saved file's duration
  shotCount: number
  effects: {
    hookStyle: boolean
    hookPosition: number   // 0-100
    zoom: { scale: number; direction: 'in' | 'out'; at: number; duration: number | null } | null
    sticker: { emoji: string; placement: string; motion: string } | null   // null = no line-1 emoji
    fairies: { enabled: boolean; cameoEmojis: string[]; finale: boolean }
    subtitles: { burned: boolean; japanese: boolean }
    bgm: { trackId: string; title: string; volume: number } | null
    voicePreset: string
    /** null when the saved 結合 predates this change (its paddings weren't stored). */
    trim: { firstStart: number; start: number; end: number; lastEnd: number; pauseShots: number } | null
  }
}
```

`trim` is the global padding used, plus how many shots had 間を残す on.
It is stored with each 結合 in `FinalizeProgress` (decided: a 結合 saved
before this change is *not* forced to re-combine, so in-progress subtitle
work survives; its record has `trim: null`).
`fairies.cameoEmojis` and `finale` come from the fairy plan of the burn
that was used. If subtitles weren't burned, there are no fairies. (Fairies
are drawn by the subtitle burn, so check this.)

**Accuracy (the anti-goal above).** The effects must come from the inputs
used to produce `exportBlob`, captured when the subtitle burn and the BGM
mix ran. Reading `settings` at save time is wrong. How to capture them is
up to the builder. One way: keep the `HookOptions`/BGM inputs next to the
blob each stage produces.

### Where

- Client: `POST /api/records` with the inbox key, the same auth as
  `/api/inbox` and `/api/subtitles` (`withAuthedJson`).
- Server: a `RecordStore` on the same Upstash Redis, key
  `record:<scriptId>`. TTL 120 days, so a record outlives the weeks between
  saving, posting and the Saturday that reads it.
- Connector: a new read-only tool on the existing MCP server,
  `list_video_records`, with an optional `since` (ISO date). It returns the
  records saved since then, newest first, as JSON text. The description
  (Japanese, like the others) says what it is for: matching TikTok videos
  to how they were made, by `hookLine` and date.

## 2. Tighter cuts

- `trimPaddingStart` default 0.3 → **0.1**, `trimPaddingEnd` 0.4 → **0.2**.
  That leaves about 0.3 s at each cut instead of 0.7 s.
- The 前に残す時間 / 後ろに残す時間 sliders currently stop at 0.2 s. They go
  down to **0** in **0.05** steps, displayed with two decimals like the
  first-shot slider.
- **Migration.** The whole settings object is stored, so the user's
  iPhone has 0.3/0.4 saved and a new default alone changes nothing. Same
  pattern as the `punchInZoom` migration in `migrateSettings`: if the
  stored settings come from before this change (no `lastShotPaddingEnd`
  key) and a value equals the old default, move it to the new default. A
  value the user changed stays as it is.
- Per-shot overrides written by the record page's per-shot toggle
  (`shot.trimPaddingStart/End`) still win. They're rare. Leave them alone.

## 3. 間を残す (per-shot pause)

- `Shot.keepPause?: boolean`, stored with the script (also add it to the
  backup validation in `scriptBackup.ts`).
- In the finalize trim step, next to the selected shot's trimmer: a
  switch, 「このショットの後に間を残す」.
- On: that shot's end padding becomes **0.4 s** (the old default), a
  constant. It takes precedence over the global and last-shot end padding
  and over a per-shot `trimPaddingEnd`. Turning it on or off recomputes
  that shot's auto-trim, like changing the paddings does today. If the
  user has already dragged the trim handles for that shot, their trim
  wins. Reuse whatever "manual trim beats auto" rule `setAutoTrim`
  already follows.

## 4. Tight ending

- New setting `lastShotPaddingEnd`, default **0.1**. It sits in the
  settings next to 「最初のショットの前に残す時間」 with the same slider (0-0.5,
  step 0.05). Label: 「最後のショットの後ろに残す時間」.
- `resolveShotTrimSettings` gets an `isLastShot` flag, the same way it has
  `isFirstShot`. A one-shot video is both first and last.
- **Keep the finale (decided).** `finaleTiming` drops the finale under
  1.0 s and shortens it under 1.2 s. Short last lines are common
  (punchlines), so the last shot's auto-trim never makes it shorter than
  **1.2 s**: its end grows past `speechEnd + lastShotPaddingEnd` until the
  trimmed shot is 1.2 s, capped at the clip's end. Manual trims are not
  touched.

## Routine change (separate, user approves)

After the app ships, the Saturday steps of the "TikTok台本ネタ出し"
routine get roughly these additions:

- 0-2: call `list_video_records` (since 3 weeks ago). Match each TikTok
  video to a record by `hookLine` and date, and write a short `effects`
  summary into the script file's frontmatter (e.g.
  `effects: zoom-out 1.25 @0.4/1.2s, sticker 🧴 right random, fairies 2, bgm lofi-tokyo, cuts 0.1/0.2, pauses 1`).
  Only that key. The other keys follow the existing rules.
- 0-3: in the 冒頭2秒 analysis, group the videos by their opening effects
  (zoom direction, sticker or not) using `effects`, instead of guessing.
  The pacing change (cuts, pauses) goes in as a column for the
  completion-rate comparison.

The routine already refers to the teleprompter connector
(`send_to_teleprompter`), so the connector is assumed to be attached. The
added steps say: if `list_video_records` isn't available, skip it and say
so in one line. The exact wording is drafted when the PR is ready and
shown to the user before the routine is updated.

## Testing

- Store, API handler and MCP tool: unit tests with the existing
  `fakeRedis`, the same as inbox/subtitles.
- `migrateSettings`: old defaults move, changed values stay, new settings
  are untouched.
- `resolveShotTrimSettings`: first/last/middle, one-shot video,
  `keepPause` precedence.
- Record building: given the burn and BGM inputs, the effects are correct.
  A settings change after the burn doesn't leak in.
- Manual on device after deploy: save a video, check the record arrives
  through the connector. Toggle 間を残す and hear the pause.
