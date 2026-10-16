# Sticker Fairies: Mid-Video Cameos, a Finale, and Sparkles

**Date:** 2026-10-16
**Status:** Approved (brainstorming)
**Builds on:** `2026-10-10-hook-v2-design.md` and the first-shot sticker
(PRs #66, #67, #71)

## Problem

The emoji sticker only exists in the first shot. After the hook, the rest
of the video has nothing playful to look at. A sticker that stays on
screen all the time would be annoying. It would compete with the face and
the subtitles, and it would make the first shot's sticker less special.

## Goal

1. **Cameos.** In a few middle shots, chosen by the script, that line's
   emoji flies through for about a second as a small "fairy" that leaves
   sparkles behind it.
2. **Finale.** In the last shot, line 1's emoji flies back and lands at
   the sticker's spot. It floats there, then bursts into sparkles and is
   gone before the cut.
3. **Sparkles on the first-shot sticker too.** It leaves a trail while it
   travels, bursts when it lands, and twinkles while it sits still. To
   make room for the sparkles it is drawn a little smaller: 200 px instead
   of 220 px.

Everything must look the same in three places: the per-shot burn, the
whole-video burn (WebCodecs), and `SubtitleOverlayPreview`. The
ffmpeg.wasm last resort shows no fairies and no sparkles.

## Non-goals

- **Sound effects.** A short synthesized chime on each fairy is the
  planned next PR. Not in this one.
- **Fantasy BGM.** The usual BGM stays as it is.
- **ffmpeg.wasm support.** That path can only place still images, and a
  still fairy doesn't read as a fairy.
- **Per-line controls in the UI.** Where cameos appear is decided by the
  script's emoji, which Claude adds and the user can edit.

## Where fairies appear

Let the script lines be shots `0 … n-1`. Each shot is one script line.

- **Shot 0.** This shot keeps the existing sticker (unchanged, plus
  sparkles).
- **Cameo shots.** These are shots `1 … n-2` whose script line has an
  emoji (`findSticker(text)`). The cameo's emoji is that line's emoji.
- **Finale shot.** This is shot `n-1`, when `n ≥ 2` and line 0 has an
  emoji. The finale's emoji is line 0's emoji. An emoji on the last line
  is ignored, because the finale takes that shot.

Fairies are decided from the **script lines** (`ShotCueInput.text`), not
from the subtitle cues. So they appear the same way whether the subtitles
came from the script or from speech.

No fairies (no cameos and no finale) when any of these holds:

- the sticker placement is `off`
- the new `fairyEnabled` setting is off
- the video has no shot clips

The first-shot sticker's sparkles follow the sticker itself. They show
whenever the sticker shows, and they don't depend on `fairyEnabled`.

### Claude's instructions (`server/mcp.ts`)

The `send_to_teleprompter` description changes:

- **Old rule:** 「2行目以降には絵文字を入れません」
- **New rule:** Line 1 keeps exactly one emoji, as before. Among the
  middle lines (not line 1, not the last line), Claude puts one emoji on
  **at most two** lines in total. These are lines that name a concrete
  thing or are a turning point of the story. Those emoji are not drawn in
  the subtitle text. They fly across that shot briefly as a small fairy.
  The last line has no emoji. Line 1's emoji comes back by itself in the
  last shot.

## Timing: everything ends before the cut

All times below are in the shot's own timeline. `D` is the shot's
duration. `END_MARGIN = 0.1 s`: every fairy and every sparkle is gone at
least this long before the cut.

### Cameos

| Motion | Name in code | Nominal length |
|---|---|---|
| A ふわっと横切る | `glide` | 1.2 s |
| B ひょっこり顔を出す | `peek` | 1.6 s |
| C くるりんと一回転 | `loop` | 1.4 s |

- **Start.** A cameo starts at `CAMEO_DELAY = 0.3 s`, clear of the cut.
- **Available time.** `available = D − CAMEO_DELAY − END_MARGIN`.
  - If `available ≥ nominal`, the cameo plays at its nominal length.
  - Else if `available ≥ MIN_CAMEO = 0.8 s`, the same motion is
    time-compressed to `available`.
  - Else the shot has no cameo.
- **Which motion.** The motion is picked per cameo from a seed:
  `stickerSeed(lineText, stickerRoute)`. So it is fixed per video, and
  ルートを変える re-rolls it together with the first shot's trip. The
  same seed also picks the entry side (left or right, mirrored).

### Finale

The finale starts at the shot's first frame (0 s) and has three phases:
fly-in, hover, and burst.

- **Fly-in.** `FINALE_FLY = 0.6 s`, from off-frame to home. It eases
  in, grows from 0.6× to 1×, and turns from −25° to home's rotation. It
  ends with a small landing burst.
  - It enters from the side edge nearer to home, at x = −0.1 or 1.1 and
    y = home.y − 0.22. That keeps it above the button column.
  - A `chest` home is centered, so it enters from the right.
- **Hover.** It bobs at home: y ±0.012 of the frame height, rotation
  ±5°. It twinkles throughout.
- **Burst.** `FINALE_BURST = 0.3 s`. It grows to 1.4× while fading out,
  with a big sparkle burst at the start.
- **Fitting it to the shot.** The burst ends at `D − END_MARGIN`.
  - If `D ≥ 1.2 s`: `hover = D − FINALE_FLY − FINALE_BURST − END_MARGIN`.
  - If `1.0 s ≤ D < 1.2 s`: hover is fixed at 0.2 s and the fly-in shrinks
    to `D − 0.6 s`.
  - If `D < 1.0 s`: no finale.
- **Home.** Home is `STICKER_PLACEMENTS[placement]`, the first shot's
  spot. The finale is drawn at the full sticker size (scale 1).

### First-shot sticker

- **Trip unchanged.** The sticker's trip and its landing pop stay as they
  are.
- **Sparkle cutoff.** Its sparkles stop so that every particle has died
  by the first shot's end, using the same cutoff rule as below.

## Look

### Sizes

- **First-shot sticker.** `STICKER_EMOJI_PX` goes from 220 to 200, and
  `STICKER_OUTLINE_PX` from 14 to 13. `STICKER_IMAGE_HEIGHT` stays at 420.
- **Cameo fairies.** These are drawn at `FAIRY_SCALE = 0.62` of the
  sticker's size. The cameo paths' own scale values multiply on top of
  that.
- **Finale.** The finale is drawn at scale 1.

### Cameo paths

These coordinates are fractions of the frame, for the left entry.

A plain `x → 1 − x` mirror would put the right entry inside the button
column, so the right entry is built differently for each motion:

- **`glide`.** The right entry is the left path played backwards: it
  enters at the upper right and leaves at the lower left.
- **`peek` and `loop`.** The right entry mirrors `x → 1 − x` and lifts the
  path by `y → y − 0.16`. The hover point becomes (0.78, 0.36), and the
  loop's center moves to the same point.

- **`glide`.** It enters at x = −0.1, y = 0.66 and exits at x = 1.1,
  y = 0.30. Along the way it waves ±0.035 vertically (2 full waves) and
  wobbles ±12° at about 2 Hz.
- **`peek`.** It has three phases:
  - flies in over 0.45 s to (0.22, 0.52)
  - hovers for 0.7 s with a bob (±0.02 y, ±8°, ±6% scale)
  - zips up and out over 0.45 s, shrinking to 0.7×, with a burst as it
    leaves
- **`loop`.** It has three phases:
  - enters over 0.4 s to (0.22, 0.6)
  - makes one loop of radius 0.09 × 0.08 around (0.22, 0.52) over 0.6 s,
    at 1.1×
  - exits up and to the right over 0.4 s

**Safe areas.** Paths reuse the zones from `stickerMotion.ts`:

- **Top.** They stay below y = 0.27, under the hook subtitle and the
  feed's top bar.
- **Button column.** They avoid the TikTok/Reels button column
  (x > 0.7 and y > 0.5) except while entering or exiting at the frame
  edge. A right-side entry or exit uses y < 0.5.
- **Face.** They only pass over the face. They never hover on it.
- **Shared constants.** `AREA`, `inButtonColumn` and `onFace` are
  exported from `stickerMotion.ts` instead of being duplicated.

### Sparkles

Sparkles are four-point concave stars, drawn with four quadratic curves
through the center.

- **Colors.** White `#FFFFFF` about 55% of the time, `#FAC775` otherwise.
  No glow.
- **Size.** The radius is 10–28 px at 1080 width. It shrinks to 30% over
  the particle's life and twinkles: the size is multiplied by
  `0.6 + 0.4·sin(age·30)`.
- **Opacity.** It fades linearly from 1 to 0 over the particle's life.
- **Life.** 0.40–0.75 s.

Particles come from three kinds of emission:

| Emission | When | Rate | Motion |
|---|---|---|---|
| Trail | while the source moves | 120 / s | spawned within ±0.5 sprite radius, drifting down 0.02 frame-heights/s |
| Burst | landing, finale burst, `peek` exit | 18 at once | radial, 0.18–0.40 frame-widths/s (y scaled by 1080/1920) |
| Twinkle | while the source sits still | 7 / s | spawned within ±0.7 sprite radius, no drift |

**Deterministic.** All randomness comes from a seeded generator
(mulberry32, seeded per appearance). Emission is computed once, ahead of
time, by sampling the path at 1/120 s steps. The result is a list of
particles, each with a birth time, birth position, velocity, life, radius
and color. Any frame can then be drawn from `t` alone. So the preview,
the per-shot burn and the whole-video burn draw the same particles.

**Cutoff.** A particle's life is clamped to `end − birth`, where `end` is
its appearance's end. A particle left with less than 0.1 s of life is
dropped. Emission stops at `end − 0.1 s`.

**Draw order.** Sparkles are drawn under their sprite.

## Architecture

### New: `src/utils/seededRandom.ts`

`hash` (FNV-1a) and `random` (mulberry32) move here from
`stickerMotion.ts`. Both `stickerMotion.ts` and the new modules import
them.

### New: `src/utils/fairyMotion.ts`

```ts
export type FairyMotion = 'glide' | 'peek' | 'loop'
export const FAIRY_MOTIONS: FairyMotion[]
/** The cameo's path over `length` seconds, local time 0…length; `mirror` = enter from the right. */
export function cameoPath(motion: FairyMotion, length: number, mirror: boolean): StickerPath
/** Moments in local time where a cameo bursts (peek's exit). */
export function cameoBursts(motion: FairyMotion, length: number): number[]
/** The finale's path over the shot (`duration`), landing at `home`; null when the shot is too short. */
export function finaleTiming(duration: number): { fly: number; hover: number; burst: number } | null
export function finalePath(home: Home, timing: FinaleTiming): StickerPath
```

- **Same shape as the sticker trip.** These are pure functions in the
  same style as `stickerMotion.ts`'s `TRIPS`.
- **Nominal lengths.** Paths are written for their nominal length and
  time-scaled when a cameo has to be compressed.

### New: `src/utils/fairyPlan.ts`

```ts
export interface FairyAppearance {
  emoji: string
  kind: 'cameo' | 'finale'
  /** Seconds on the timeline this plan was made for. */
  start: number
  end: number
  /** Pose at absolute time t (same timeline as start/end). */
  path: StickerPath
  /** Size relative to the sticker: FAIRY_SCALE for cameos, 1 for the finale. */
  scale: number
  /** Precomputed particles, absolute times. */
  sparkles: Sparkle[]
  /** What decides the pixels, for burn cache keys. */
  key: string
}

export function planFairies(
  shots: { text: string; duration: number }[],
  hook: Pick<HookOptions, 'sticker' | 'stickerRoute' | 'fairies'>,
): FairyAppearance[]

/** The appearances inside one shot, moved into its own timeline. */
export function fairiesForShot(plan: FairyAppearance[], shotStart: number, shotDuration: number): FairyAppearance[]
```

- **Timeline.** `planFairies` works on the joined timeline, where each
  shot starts where the previous one ended (as in `cuesFromShotEntries`).
- **Slicing per shot.** Each appearance lies inside one shot, so
  `fairiesForShot` filters by shot and shifts `start`, `end`, the path
  and the sparkles' times.

### New: `src/utils/sparkles.ts`

```ts
export interface Sparkle { born: number; life: number; x: number; y: number; vx: number; vy: number; radius: number; color: string }
export function emitSparkles(opts: {
  path: StickerPath; start: number; end: number; seed: number;
  /** Sprite radius as a fraction of the frame width, for spawn spread. */
  spread: number;
  /** Times of bursts. */
  bursts: number[];
  /** Whether the source is moving at t (trail) or still (twinkle). */
  moving: (t: number) => boolean;
}): Sparkle[]
export function drawSparkles(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sparkles: Sparkle[], t: number, width: number, height: number): void
```

- **One drawing function.** `drawSparkles` is the only star-drawing code.
  The WebCodecs compositor and the preview both use it.

### First-shot sticker: `stickerMotion.ts`

- **New field.** `PlacedSticker` gains `sparkles: Sparkle[]`, emitted
  over `[0, firstShotDuration)`:
  - a trail while the trip moves
  - a burst at the landing (`travel` seconds)
  - twinkles while it sits still, which covers the whole shot for
    `none` or a shot too short for a trip
- **Same seed.** The seed is derived from the sticker's existing seed.

### Settings and options

- **`AppSettings`.** Adds `fairyEnabled: boolean`, default `true`.
- **`HookOptions`.** Adds `fairies?: boolean`. `hookOptionsOf` maps
  `fairyEnabled` onto it, and `HookSettings` includes it.
- **UI.** `SubtitleWorkflow` adds a 妖精（途中と締め） ON / OFF button
  pair in the sticker section, styled like the motion buttons. It is
  hidden when the placement is `off`.

### Burn path

- **Script text reaches the burn.** `ShotClip` gains `text: string`, the
  shot's script line. `FinalizePage` already has it when it builds the
  clips and `shotCueInputs`.
- **`SubtitleLook`.** Gains `fairies: FairyAppearance[]`, already in that
  video's own timeline.
  - The per-shot path gets `fairiesForShot(...)` of the plan.
  - The whole-video path gets the full plan.
- **`shotBurnRequests`.** Builds the plan once with `planFairies(clips…)`
  and passes each shot its slice.
- **`burnRequest`'s cache key.** Includes `fairies.map(f => f.key)`, plus
  the sticker size and sparkles. Changing the sticker constants changes
  pixels, so the key includes a version tag `sparkles-v1`. Old cached
  shots then can't be reused for the sticker shot.
- **Encodes even without subtitles.** A shot with fairies but no
  translated cues still needs an encode. That applies to:
  - `burnRequest`
  - the early return in `burnSubtitlesByShot`
  - the early return in `burnSubtitles`

  Each checks `look.fairies.length > 0` (or the plan's length) next to
  `hasFirstShotExtras`.
- **`renderSubtitleOverlays`.**
  - For each fairy, it pushes a sprite overlay. It reuses
    `renderStickerSprite(emoji)`, and `FAIRY_SCALE` folds into the drawn
    scale.
  - The sticker's overlay and each fairy's overlay carry `sparkles`.
  - With `still: true` (ffmpeg), fairies and sparkles are skipped. The
    sticker stays as it is today.
- **`SubtitleOverlay`.**
  - `sprite` gains `scale?: number` (default 1) and
    `sparkles?: Sparkle[]`.
  - Sprite overlays may now also fade out, for the finale's burst. The
    path's pose gains an optional `opacity` (default 1), which the
    compositor applies with `globalAlpha`.
- **`createOverlayProcess`.** For an active sprite overlay it:
  1. draws `drawSparkles(ctx, sparkles, t, width, height)`
  2. then draws the shadow
  3. then draws the sprite at `pose.scale * scale`

### Emoji never in subtitle text

- **What changes.** Today `stripStickers` is applied to hook cues only.
  It is applied to **every** cue, both in `renderSubtitleOverlays` and in
  the preview's `layoutCue` call. Script-sourced cues for cameo lines
  carry their emoji.
- **Translation prompt.** `buildClaudePrompt` is unchanged.

### Preview: `SubtitleOverlayPreview`

- **New prop.** It takes `shots?: ShotCueInput[]` and computes
  `planFairies(shots, hook)` in a `useMemo`.
- **Shared sprite element.** The sticker `<span>` is factored into a
  small `StickerSprite` element, used for the sticker and for each active
  fairy. It takes the emoji, pose, scale and opacity.
- **Sparkle canvas.** A `<canvas>` fills the preview, sized to the
  container with a `ResizeObserver` × `devicePixelRatio`. It draws the
  active sticker's and fairies' sparkles at `currentTime`. When
  `getContext` returns null (jsdom), it draws nothing.
- **Frame-accurate time.** `followsFrames` takes the fairy plan as well.
  It returns true within any appearance's `[start − 0.1, end + 0.1]`, so
  `useVideoFrameTime` drives the preview per frame there.
- **Sparkles on the first shot.** The first shot always counts as moving
  when a sticker is shown, because it now always has sparkles.

## Testing

- **`fairyPlan.test.ts`:**
  - which shots get cameos: middle lines with emoji only, never the last
    line
  - the finale needs line 0's emoji and `n ≥ 2`
  - no fairies with placement `off` or `fairies: false`
  - the cameo is compressed between 0.8 s and its nominal length, and
    skipped below that
  - the finale's three duration bands, and that it ends exactly at
    `D − 0.1`
  - the same input gives the same plan, and a new `stickerRoute` changes
    the motion
  - `fairiesForShot` shifts into the shot's timeline
- **`sparkles.test.ts`:**
  - deterministic for the same seed
  - every particle has `born + life ≤ end`, and none has a life under
    0.1 s
  - a burst emits 18 particles at its time
  - `drawSparkles` only draws the particles alive at `t`, checked with a
    mock context
- **`fairyMotion.test.ts`:**
  - each cameo starts and ends off-frame or at the edge
  - mirroring
  - the finale lands exactly at home at the end of the fly-in
  - the finale's opacity reaches 0 at the end
- **`burnSubtitles` / `shotEncoding`:**
  - the cache key changes with the fairies
  - a shot with only a fairy is still burned
  - ffmpeg overlays have no fairies
  - normal cues have their emoji stripped
- **`SubtitleOverlayPreview.test.tsx`:**
  - a fairy sprite shows during its window and not outside it
  - the sticker uses the new size
- **`useSettings.test.ts`:** the `fairyEnabled` default.
- **`mcp.test.ts`:** the description contains the new emoji rule.
- **On device.** Check the size, the trails and that the finale ends
  before the cut on an iPhone. Mind the stale-PWA caveat: relaunch the
  home-screen app after the deploy.
