# 挿入カードのナレーション声 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card whose words Yuji recorded in teleprompter-cam plays them in a deep, echoed narrator voice after the pop; cards with no recording stay as they are.

**Architecture:** The camera app lists card rows in its voice sheet and saves `-voice-card-` files named after the shot the card follows. The web app's import keeps those (own IndexedDB store, by script + card id) instead of using them for a take. `cardClipsOf` loads a card's voice, shapes it (`narratorVoice`) and draws the card as long as the voice needs.

**Tech Stack:** React + TS + Vitest (web, `~/Site/teleprompter`), SwiftUI + XCTest (camera, `~/Site/teleprompter-cam`), mediabunny/WebCodecs.

**Spec:** `docs/superpowers/specs/2026-11-19-card-narration-design.md`

## Global Constraints
- Work in worktrees `.claude/worktrees/card-voice` of each repo (branch `feat/card-voice`); never switch the main checkouts' branches.
- Type-check with `npx tsc -b` (not `--noEmit -p .`).
- A card with no voice: clip bytes, length (`CARD_SECONDS` = 1.8) and cache key unchanged from today.
- Card voice file name: `TeleprompterCam-<tag>-voice-card-shot<i>of<n>-<shot.id>.m4a`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. User-facing copy in Japanese.

## Review Focus
- A `-voice-card-` file for a shot that is also 相手のセリフ/心の声: must not replace that line's voice (web `voicesByShotId`, camera `voiceFile(in:endingWith:)`). → tests in Tasks 2 and 5.
- A card voice imported with no takes picked (only voice files): today that errors "相手の声のファイルだけ"; card voices alone should be saved and say so. → Task 2 test.
- A card voice whose card was later deleted or moved to another line: card id gone → voice ignored and pruned. → Task 1 prune test, Task 3 test.
- A silent/empty recording (no speech found): card is drawn as without a voice, with a console warning, not a failed 結合. → Task 3 test.
- One-take (通し) scripts have no cards (`cardsInOrder` returns []): nothing to do; the camera must not list card rows then either (`cardAfter` absent). → covered by existing `camShotsOf`.

---

### Task 1: Card voice store + narrator voice (web)

**Files:**
- Create: `src/utils/cardVoiceStore.ts`, `src/utils/cardVoiceStore.test.ts`
- Modify: `src/utils/voiceEffects.ts` (+ test file `src/utils/voiceEffects.test.ts`), `src/pages/HomePage.tsx:64`

**Interfaces:**
- Produces: `saveCardVoice(scriptId: string, cardId: string, blob: Blob): Promise<void>`, `getCardVoice(scriptId: string, cardId: string): Promise<{ blob: Blob; savedAt: string } | null>`, `pruneCardVoices(scripts: { id: string; cards?: { id: string }[] }[]): Promise<void>` — DB `teleprompter-card-voices`, follow `lineImageStore.ts`'s pattern (fake-indexeddb in tests like `shotVideoStore.test.ts`).
- Produces: `narratorVoice(samples: Float32Array, sampleRate: number): Float32Array` in `voiceEffects.ts`: pitch `semitones(-7)`, formant `0.8`, `darken` keep `0.6`, then the thought echo with `{ wet: 0.25, feedback: 0.3 }`-ish and a soft clip `tanh(1.8·x)/tanh(1.8)`; output longer than input by the echo tail (as `thinkingVoice`). Reuse the internals `shapeVoice`/`thinkingVoice` use; don't duplicate them.

- [ ] Tests: store round-trips; `pruneCardVoices` drops entries whose script or card id is gone and keeps the rest. `narratorVoice` on a 200 Hz sine: result length ≥ input, peak ≤ 1, dominant frequency lower than 200 Hz (zero-crossing count below input's).
- [ ] Run, see them fail; implement; run `npx vitest run src/utils/cardVoiceStore.test.ts src/utils/voiceEffects.test.ts` → PASS.
- [ ] HomePage: call `pruneCardVoices(scripts)` next to `pruneRemovedShotVideos(scripts)`.
- [ ] Commit `挿入カードの声: store and narrator voice`.

### Task 2: Import card voices with the takes (web)

**Files:**
- Modify: `src/utils/matchShotRecordings.ts` (+ test), `src/pages/RecordPage.tsx:80-110` (+ `RecordPage.test.tsx`)

**Interfaces:**
- Consumes: `saveCardVoice` (Task 1), `cardsInOrder` (insertCard.ts).
- Produces: `isCardVoiceFile(file: Pick<File,'name'>): boolean` (`/-voice-card-shot\d+of\d+-/`). `voicesByShotId` and `voiceOfVoiceFile` ignore card voice files.

- [ ] Tests (matchShotRecordings): `isCardVoiceFile('TeleprompterCam-x-voice-card-shot2of5-<uuid>.m4a')` true, a line voice false; `voicesByShotId([lineVoice, cardVoiceSameShot])` maps the shot to the line voice.
- [ ] Tests (RecordPage): picking a take + a card voice for the shot a card follows saves it for that card (`getCardVoice(script.id, card.id)` non-null) and the take is imported as usual; picking only card voice files saves them and shows `カードの声を保存しました（N枚）` with no error; a card voice for a shot no card follows is ignored.
- [ ] Implement in `handleImportVideos`: split `picked` into card voices / line voices / takes first; save card voices (shot id → card after it); then if no takes, show the message and return.
- [ ] `npx vitest run src/utils/matchShotRecordings.test.ts src/pages/RecordPage.test.tsx` → PASS. Commit `挿入カードの声: import with the takes`.

### Task 3: Card clip with the voice (web)

**Files:**
- Modify: `src/utils/cardClips.ts`, `src/utils/webcodecs/cardClip.ts`, `src/utils/insertCard.ts` (+ tests `insertCard.test.ts`, `FinalizePage.test.tsx`)

**Interfaces:**
- Consumes: `getCardVoice`, `narratorVoice`, `levelVoice`, `reduceNoise`, `detectSpeech` (trim to speech with `VOICE_PADDING_S`).
- Produces: `CARD_VOICE_START_S = 0.25`, `CARD_VOICE_TAIL_S = 0.4`, `cardSecondsFor(voiceSeconds: number | undefined): number` = `voiceSeconds === undefined ? CARD_SECONDS : Math.max(CARD_SECONDS, CARD_VOICE_START_S + voiceSeconds + CARD_VOICE_TAIL_S)` in insertCard.ts. `cardClipsOf(script, inboxKey)` gains the script id in its `Pick` (`'id'`). `rawCardClipWebCodecs(text, background, image, sound, voice?: { samples: Float32Array; sampleRate: number })`.

- [ ] Tests: `cardSecondsFor(undefined) === 1.8`, `cardSecondsFor(0.5) === 1.8`, `cardSecondsFor(2) ≈ 2.65`. FinalizePage test (mock pattern as the existing card tests): a card with a stored voice gives a clip whose `end` equals `cardSecondsFor` of the shaped voice length and whose signature differs from the voiceless one; a stored voice with no speech → clip as without voice.
- [ ] Implement: in `cardClipsOf` load the voice per card, decode + mono + `reduceNoise` + trim + `narratorVoice` + `levelVoice` (decode via `decodeAudioTrack` as `webcodecs/heardShot.ts` does — factor its `lineOf` out to share, don't copy); cache key adds the voice's `savedAt`. `rawCardClipWebCodecs`: frames and `wobblesOf` use `cardSecondsFor`; audio mixes the voice at `CARD_VOICE_START_S` after the pop; buffer length = seconds + 0.1.
- [ ] `npx vitest run` (whole suite) and `npx tsc -b` → PASS. Commit `挿入カードの声: the card reads its words`.

### Task 4: Editor shows which cards have a voice (web, small)

**Files:** Modify `src/components/InsertCardEditor.tsx` (+ its test if present)
- [ ] The badge reads `🎬 カード（{秒}秒）🎙️ 声あり` when `getCardVoice` finds one for this card (prop `hasVoice?: boolean` passed from ScriptEditPage). Test the badge text. Commit.

### Task 5: Camera — record the cards' words

**Files:**
- Modify: `TeleprompterCam/Teleprompter/ShotSession.swift`, `VoiceRecordingSheet.swift`, `HeardVoice.swift`, `Camera/ShotCameraScreen.swift:253-258`
- Test: `TeleprompterCamTests/CardsAndThoughtTests.swift`

**Interfaces:**
- Produces on `ShotSession`: `@Published var cardVoiceURLs: [String: URL]` (by the shot the card follows), `func newCardVoiceURL(for shot: Shot) -> URL?` (name per Global Constraints), `var cardShotCount: Int` (shots with `cardAfter`). `refreshVoices()` fills both; line voices skip names containing `-voice-card-`. `HeardVoice.effect(for: "narrator")` = pitch `-700` cents, rate `0.95` (preview only).

- [ ] Tests: card voice name contains `-voice-card-shot2of3-<id>.m4a`; with a line voice and a card voice for the same heard shot in the folder, `voiceURLs[id]` is the line voice and `cardVoiceURLs[id]` the card one.
- [ ] Sheet: a row per shot with `cardAfter` — header `🎬 カード（ショットN のあと）`, the card words, 録音/録り直す/聞く (preview with `"narrator"`), no voice menu. Intro text adds: `🎬 カードは、文字をナレーションのように読んで録ってください。Webアプリで低い声とエコーになります。`
- [ ] Camera screen: the voice button shows when `voiceShotCount + cardShotCount > 0`; its count includes cards. Filming never plays card voices (they aren't in `voiceURLs`).
- [ ] Build in the simulator per memory "Cam sim build needs Cinematic stub" and run the tests. Commit `挿入カードの声を録る`.

### Task 6: PRs
- [ ] Web: whole suite + `npx tsc -b` + `npm run build`; push, PR. Camera: PR (device check needs a Mac build).
