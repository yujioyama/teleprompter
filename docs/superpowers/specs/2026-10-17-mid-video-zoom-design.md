# Mid-Video Zoom: Drift In on the Peaks, Punch In on the Punchline

**Date:** 2026-10-17
**Status:** Approved (brainstorming)
**Builds on:** the first shot's zoom (`punchIn`, PRs #63, #69, #72), the
fairies (#73, #74), video records (#75)

## Why

Only the first shot moves. After it, the picture is a static talking head
for 60–90 s. The user wants the middle of the video to keep some motion,
but in a way that fits a calm, dry delivery:

- **Rejected: a zoom that alternates at every cut** (1.0x/1.12x). It "looks
  like I keep getting the distance to the camera wrong".
- **Rejected: a slow drift on every shot.** Nice, but more energy than these
  videos need.
- **Liked: zoom only at the key lines**, as long as the user never has to
  pick them by hand.

They compared animated mockups and picked: **the peaks drift in slowly,
the punchline punches in at the cut.**

## Goal

On every video, automatically:

1. **Peaks.** A middle shot (not the first, not the last) whose line has
   an emoji drifts in during that shot, from 1.0x to **1.12x**, eased with
   the existing `easeZoom` (smoothstep) over the whole shot. The next cut
   drops it back to 1x. These are the same lines that get a fairy cameo.
   Claude marks up to two of them per script, and the user can add or
   remove the emoji in the English subtitles.
2. **Punchline.** The last shot is at **1.18x** from its first frame to its
   end: an obvious punch in at the cut.
3. Every other shot stays at 1x. A script with no peak emoji still gets
   the punchline zoom. A one-shot video gets nothing new, because its only
   shot is the first shot.

The zoom is about the same anchor as the first shot's zoom: (50%,
`ZOOM_ANCHOR_Y` 40%), roughly the face. Only the picture zooms. The
subtitles, the sticker and the fairies keep their size and position, as
with the first shot's zoom.

## Decisions

- **Which lines are peaks:** the emoji in the shot's English subtitle
  text, read the same way the fairies read it (`shotTextsOf(cues,
  durations)` plus `findSticker`, on the joined timeline). This does not
  depend on whether a fairy cameo actually fits in the shot (a cameo is
  dropped from shots under ~1.2 s). The zoom only needs the emoji.
- **Fairies off (妖精オフ):** the peaks still drift in. The emoji marks the
  line, and the fairy is just one thing drawn on it.
- **Setting:** one switch, 「中盤のズーム」 (`midZoomEnabled`, default
  **on**). It sits in the subtitle step next to the first shot's ズーム
  settings, like the other hook settings. When it's off, nothing in this
  spec happens. The amounts (1.12 / 1.18) are constants, not settings.
- **Where it shows:** the subtitle step's preview (zooming the player the
  same way the first shot's zoom is previewed, only while playing), the
  per-shot WebCodecs burn, and the whole-video WebCodecs burn. They must
  agree.
- **ffmpeg.wasm fallback:** no mid-video zoom, the same as the fairies.
  That path keeps the first-shot zoom it has today.
- **Peaks are the story's peaks, not object mentions (decided by the
  user).** Claude's instructions put a middle-line emoji on lines where a
  concrete thing *or* a peak comes up. They become 「話の山場」 only: the turn
  or the build-up just before the punchline. This changes which lines get a
  fairy too, and that's intended. Two places change. The
  `send_to_teleprompter` description in `server/mcp.ts` is changed in this
  PR, together with its `mcp.test.ts` assertion. The Saturday routine's
  prompt is the user's to paste: hand them a v3 file with the same edit to
  its 1行目のステッカー絵文字 rule.
- **Record vs. fallback (builder's call, made):** `effects.midZoom` comes
  from the inputs sent to the burn, the same as `fairies`. If the burn
  falls back to ffmpeg.wasm, the record can say true while the video
  didn't zoom. That's rare on the iPhone and accepted, as it is for the
  fairies.
- **Video record:** `effects.midZoom: boolean` (optional in the schema, so
  older records still parse). True when the burn that was used had mid
  zoom on and at least one shot actually zoomed. The `list_video_records`
  description mentions it.

## Non-goals

- Picking peak lines by hand in the app.
- Any change to the first shot's zoom.
- Zooming the audio, the subtitles or the overlays.
- Mid zoom on the ffmpeg.wasm path.

## Anti-goals

- **A zoom that looks like a mistake.** No zoom on ordinary lines, and no
  1.0/1.12 alternation.
- **Face out of frame.** At 1.18x about the 40% anchor, a chin at ~57%
  moves to ~60%, still above the normal subtitles (72%). Bigger amounts are
  out.
- **Re-encoding everything on any change.** The per-shot burn cache key
  must change only for shots whose zoom changes. A peak emoji edit
  re-encodes that shot. The last shot's key includes the punchline zoom.

## Shape (left to the builder, within these lines)

- A pure planner, e.g. `planMidZoom(cues, durations, hook): MidZoomSegment[]`
  on the joined timeline. Each segment is `{ start, end, kind: 'drift' |
  'punch' }`. Add a shot-relative slice like `fairiesForShot`, and a pure
  `midZoomScale(t, segments)`. Unit-test those.
- `HookOptions` gains `midZoom?: boolean` (from `midZoomEnabled` through
  `hookOptionsOf`). `SubtitleLook` carries the segments, the way it carries
  `fairies`.
- `createOverlayProcess` takes one zoom function in place of the
  first-shot-only `punchIn` plan (first shot: `punchInScale`; others: the
  segments). It currently returns the untouched sample when no cue is
  active and the scale is 1. That must stay true for the shots that don't
  zoom.
- `followsFrames` must also return true during a drift (and at the
  punchline's cut), so the preview follows frames while the zoom moves.
- The per-shot `burnRequest` currently treats a shot with no subtitles, no
  first-shot extras and no fairies as a plain normalized clip. A shot with
  a mid zoom must now be burned too.

## Testing

- Planner: picks the middle emoji shots and the last shot. Ignores the
  first shot's emoji and the last shot's own emoji (the last shot gets the
  punch either way). Returns nothing for a one-shot video, and nothing
  with `midZoom: false`. A peak still counts when the shot is too short
  for a cameo or the fairies are off.
- `midZoomScale`: 1 outside segments. Drift goes 1 → 1.12, eased (check the
  start, the midpoint and the end). Punch is 1.18 for the whole segment.
- Per-shot burn requests: only affected shots change keys. A shot zoomed
  with no subtitles is still burned.
- Overlay: a frame in a drift is drawn zoomed. A frame in a non-zoom shot
  with no cue is passed through.
- Preview: the player is scaled during a peak shot while playing.
- Settings: `midZoomEnabled` defaults to true, and older stored settings
  get it.
- Record: `midZoom` is true or false as described above, and a record
  without it still parses.
- On device, after deploy: a real script with two peak emoji shows the
  drift and the punch in the burned video (the user checks).
