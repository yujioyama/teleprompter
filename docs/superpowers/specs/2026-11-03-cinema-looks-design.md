# Cinema Looks: A Picked Film Look Between the Opening Bars

**Date:** 2026-11-03
**Status:** Draft, waiting for approval (brainstorming)
**Builds on:** the Type A/B opening bars (#106–#111, `src/utils/openingLook.ts`),
the Claude inbox (`send_to_teleprompter`), video records (#75), the
"TikTok台本ネタ出し" routine

## Why

Type A/B scripts open with cinema bars, top and bottom, that hold through
line 1 and slide away (#111). The user wants the picture between the bars
to look like a film too. They didn't know what "cinematic" means in
practice, so they compared stills and animated previews of several looks
on a comparison page (https://claude.ai/artifact/4SbC98XCXoVyHZDqViHRBv,
source kept at `docs/superpowers/specs/2026-11-03-cinema-looks-reference.html`)
and picked these five:

| Id | Name (UI) | What it looks like |
|---|---|---|
| `hollywood` | ハリウッド風 | teal-and-orange: warm skin and highlights, teal shadows, more contrast, a little less color |
| `oldFilm` | 昔のフィルム | yellowed and faded, lifted blacks, flat contrast, coarse flickering grain, dust specks, hairs and vertical scratches |
| `nightBlue` | 夜の青 | color mostly drained, everything pushed blue and darker, contrasty, light grain |
| `mono` | 白黒 | black and white, high contrast, grain |
| `glitch` | グリッチ | broken TV: red and blue pulled apart sideways, a few bands torn sideways and tinted magenta/cyan, colors pushed, scanlines; jumps about while playing |

They also want the choice made for them: the daily routine that writes
their TikTok scripts should recommend a look and send it with the script.
They only change it if it looks wrong in the subtitle step's preview.

## Goal

1. A Type A/B script's opening gets one of the looks above, or none (the
   bars alone, as today). The look is over the picture only, under the
   subtitles and sticker, exactly where the bars are drawn now.
2. The look holds while the bars hold and **fades out as the bars slide
   away**: same start (`look.at`), same 0.8 s, same smoothstep ease. From
   then on the picture is untouched. (The user chose this over keeping the
   look for the whole video.)
3. Picked per video, on the **subtitle step**, next to the existing
   "Type A/B: 冒頭は映画のような黒帯が…" hint. The preview shows the
   picked look faithfully, so the user can judge it there. Picking it there
   costs no extra wait: the opening is burned in the same encode as the
   subtitles, which already runs ahead while the user is on that step.
4. Claude can send a recommended look with `send_to_teleprompter`. It
   arrives with the script and is the subtitle step's starting choice.
5. The routine "TikTok台本ネタ出し" recommends a look for each script it
   sends.
6. The look is saved in the video record, so the Saturday analysis can
   compare views by look.

## Non-goals

- No look on untyped scripts. They keep the settings' zoom and no bars.
- No strength control in the app. Each look is fixed at the comparison
  page's standard strength (its "効果の強さ" 100) and vignette 60.
- No look for the rest of the video.
- No new look beyond the five. 2 (vignette only) was dropped by the user.
- Type A and B stay as they are (the picker, `type: "A"/"B"`). A look is
  not tied to a type: either type can get any look.

## Anti-goals

- The export step must not get slower. Nothing new may be encoded there.
- The face must stay visible from the first frame (#111's rule), and the
  subtitles keep their color and position: the look is never drawn over
  them.
- The preview must not lie: if the user judges a look in the preview, the
  saved video must look the same.

## The looks, precisely

The reference implementation is the comparison page's script (the
`LOOKS` table, `vignetteMask`, `glitchFrame`, `grainFrames`, `dustFrames`
and `paint` in the reference HTML). The app's looks must match it at
k = 1 (effect strength 100) and vignette strength 0.6, scaled from its
540×960 to the output 1080×1920:

- **Color.** Each look's `fn(r, g, b, k)` per pixel, values 0–1. Port
  them as they are.
- **Vignette.** All five get it, multiplied after the color:
  `1 − 0.6 × 0.75 × smoothstep(0.35, 1.3, d)`, where
  `d = √(dx² + 0.85·dy²)`, `dx = (x − W/2)/(W/2)`, `dy = (y − 0.45H)/(H/2)`.
- **Grain** (`oldFilm` 1, `nightBlue` 0.25, `mono` 0.5): mid-gray noise
  (sum of three uniforms, ±150 around 128) at half the frame's size, scaled
  up to the frame and laid over with `'overlay'` at opacity
  `min(1, grain × 0.55)`. **Dust** (`oldFilm` only): specks, hairs and one
  or two vertical scratches, drawn `source-over`. Both re-roll about 12
  times a second of video time (`floor(t × 12)` picks the frame), so they
  flicker like film. Pre-render a handful of frames and cycle them.
- **Glitch.** Its random settings (channel split 6–16 px, 3–6 bands
  6–76 px tall shifted ±60 px, which bands are tinted) are rolled once per
  step (`floor(t × 12)`, seeded by it so a re-encode gives the same
  frames), but the glitch is redrawn from **every** video frame with that
  step's settings, so the speaker moves smoothly and only the tearing
  jumps. Then saturation ×1.6, S-curve 0.3, every other 2 px line at 78%,
  and the vignette. *(Builder-check call: the reference only had a still
  picture.)*
- **Sizes are relative to the frame**, not pixels, so the preview and the
  1080×1920 output look the same as the reference: the grain texture is
  always 270×480 scaled up to the frame (coarse grain was part of why
  昔のフィルム was picked), and every pixel length in the reference (dust
  radii, hair and scratch widths, the glitch's split, band heights and
  shifts, the 2 px scanlines) is multiplied by frame width / 540.
  *(Builder-check call.)*
- **Fade.** The look is drawn at opacity `1 − ease((t − at)/0.8)` over the
  untouched picture, grain and dust included; the bars at the same time
  shrink as they do now. Before `at`, full strength from the first frame.

## How it fits the pipeline

The opening is drawn in three places today, and each must draw the look:

1. **Hardware burn** (WebCodecs): `drawOpening` in
   `src/utils/webcodecs/pictureEffects.ts`, called from
   `createOverlayProcess` before the cues. OffscreenCanvas 2D only; no
   WebGL on this path (an existing rule of the code). This is the path
   that matters: per-shot burns of the first shot go through it.
2. **ffmpeg fallback** (`openingFilterStages`): the last-resort path.
3. **Preview** (`SubtitleWorkflow`): today the bars are two divs over the
   `<video>` and nothing else.

`OpeningLook` gains the picked look (e.g. `grade: CinemaLook | null`).
Because the first shot's encode cache key already includes the whole
opening plan (`shotEncoding.ts` `burnRequest`), changing the look
re-burns only the first shot, as changing the bars does.

Decided:
- The look is computed per frame on the hardware path for the opening's
  frames only (`openingActive`), at 1080×1920. It must be fast enough on
  an iPhone that the first shot's burn isn't noticeably slower: at most
  a few seconds extra for ~80 frames. Precompute whatever doesn't change
  per frame (a color LUT, the vignette mask, grain and dust frames).
- The preview must show the same look. Plain CSS filters can't, so the
  preview draws the opening's frames itself on a canvas over the
  `<video>` while the look is active, using the same look code as the burn
  (at the preview's size). Only while playing, as the bars are now.
- The ffmpeg fallback may approximate the color (e.g. `lut3d` from a
  generated `.cube`, or `colorbalance`/`eq`/`hue`), and may leave out
  grain, dust and the glitch's motion. It must not fail because of a look.

If it's too slow, speed wins over sharpness (the user's choice): measure
the first shot's burn on an iPhone with and without a look. If the look
adds more than a few seconds, compute the look at half resolution
(540×960) and scale it up to the frame for the opening's frames only;
the picture may be a little softer for those 2–3 s. Keep WebGL off this
path either way. The preview may do the same.

Left to the builder: how the color is made fast (a 3D LUT is the obvious
choice), how the preview canvas is synced to the video's frames, how the
fallback approximates.

## Data flow

- **MCP** (`server/mcp.ts`): `send_to_teleprompter` gains an optional
  `look` enum (`none`, `hollywood`, `oldFilm`, `nightBlue`, `mono`,
  `glitch`). Its description says what each looks like in a phrase,
  that it only applies with `type` A or B, and to pick the one that suits
  the story (e.g. `oldFilm` for a memory, `nightBlue` for something
  serious, `glitch` for something chaotic or funny). The tool text is
  Japanese, like the rest.
- **Inbox** (`shared/inbox.ts`, `server/inboxStore.ts`): `InboxItem.look`,
  optional. A look sent without a type is kept but has no effect.
- **Script** (`src/types.ts`, `useScripts`, the inbox import): `Script.look`,
  optional. Absent = none.
- **Subtitle step**: a picker for a typed script: なし, ハリウッド風,
  昔のフィルム, 夜の青, 白黒, グリッチ, starting at `script.look`. Changing it
  saves to the script (so leaving and coming back keeps it) and restarts
  the ahead-of-time burn as any other hook change does.
- **FinalizePage**: builds the hook with the script's look, as it does
  with `videoType` today (`withVideoType`).
- **Video record** (`shared/videoRecord.ts`, `src/utils/videoRecord.ts`):
  `effects.opening` gains the look, e.g.
  `{ kind: 'letterbox', at, look: 'oldFilm' | null }`. Optional, so old
  records still parse. Update `list_video_records`' description in
  `server/mcp.ts`.

## The routine

The routine's prompt lives in claude.ai, not in this repo. The newest
local copy (`.claude/tiktok-routine-prompt-2026-10-17-v3.md` in the main
checkout) predates Type A/B, so read the live prompt first with
RemoteTrigger `get` on `trig_01UYaa8o8j9W7XKrQ6nDQ3kL`
(`derived_state.prompt`). Write a new version next to it that adds, where
the script is sent to the teleprompter: pick a `look` for each Type A/B
script and send it. Add the look to the `effects` write-back line, and to
the Saturday comparison as a column. Hand the file to the user to paste
in the claude.ai UI (don't update the trigger through the API; its config
carries a ~120 KB session context), then check it with `get` after they
paste.

## Also

Two comments still describe the gone color pop and should be fixed in
passing: `shared/inbox.ts` ("Each gets its own opening look") and
`OverlayOptions.opening` in `subtitleOverlay.ts` ("black bars, color pop").

## Done when

- A Type A/B script sent with a look opens in the subtitle step with that
  look picked, and the preview shows it while playing, fading out with
  the bars.
- The saved video's opening matches the preview, on the hardware path.
- Changing the look re-burns only the first shot; the export step does no
  new encode.
- The record carries the look; old records still parse.
- The routine's new prompt version is written and handed over.
