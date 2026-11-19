# 挿入カードのナレーション声 — design (short)

Approved by Yuji 2026-11-19.

## Why
Cards like "Meanwhile, upstairs..." / "Two weeks later" should be read out in a low,
slightly devilish narrator voice (documentary / cartoon "… later" style).

## Goals / non-goals
- A card with a recorded voice plays it, deep and echoed, after the pop. A card with none stays as today (silent + pop).
- Yuji records the words himself in teleprompter-cam; no TTS service (browser speech can't be captured into the video; an external TTS needs a paid key).
- Non-goal: a per-card `voice` flag from Claude chat. Every card is listed for recording; recording one is the choice.
- Anti-goal: anything that changes how existing scripts / cards without a voice come out.

## Approaches
1. **Record in the camera app, process in the web app (picked).** Same path as 相手の声: the camera's voice sheet lists card rows, the file is imported with the takes, the web app shapes it.
2. TTS via an external API — rejected: cost, a key, and a stock voice.
3. Record in the web app — rejected: Yuji already records voices in the camera app; a second recorder is more UI for the same thing.

## Design
- **Camera app**: `Shot.cardAfter` already carries the card text. The voice sheet gets a 🎬 row per shot with `cardAfter`. Its file: `TeleprompterCam-<tag>-voice-card-shot<i>of<n>-<shot.id>.m4a` (the shot the card follows). Not played while filming.
- **Web app import**: a `-voice-card-` file is told apart from a line's voice; it is saved (own small IndexedDB store, keyed by script + card id) for the card after that shot, not used for the take.
- **Card clip**: with a voice, the audio is pop + the voice (noise-reduced, trimmed to its speech, leveled, then a "narrator" shape: lower than スロー in pitch and body, a little echo and soft distortion), starting just after the pop. Card length = max(CARD_SECONDS, voice start + voice length + tail). Letters/wobbles run for that length. BGM muffle already follows the card clip's span.
- Cache key for the drawn card includes the voice (so a new recording re-draws it).

## Left to the builder
- Exact pitch/formant/echo/distortion numbers (tune by ear on "See It Works" and "This Arvo").
- Whether the editor shows "🎙️ 声あり" on a card.
