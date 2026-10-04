# Default BGM, Default Subtitle Position, Fewer Finalize Taps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A usual BGM (Tokyo Lofi by default) and BGM volume set once in Settings are added automatically after the subtitle burn; English subtitles generate themselves; the subtitle step opens at a default position set in Settings against short and long sample cues; and on the WebCodecs path the BGM + loudness audio is prepared during the subtitle step so the post-burn wait is one packet copy.

**Architecture:** Three new settings in `useSettings`. `MusicMixer` gains initial track/volume, an `autoMix` mode and an injectable `mix` function; `FinalizePage` turns `autoMix` on for the BGM step entered straight from a burn. A new `PreparedAudio` holder (`src/utils/preparedAudio.ts`) builds the final audio from `combinedBlob` via a new WebCodecs module (`src/utils/webcodecs/finalAudio.ts`) and `mixForExport` joins it to the burned video, falling back to `mixMusic`. Settings UI is split into two focused components.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library (jsdom), mediabunny (WebCodecs muxing), CSS modules.

**Spec:** `docs/superpowers/specs/2026-10-04-default-bgm-subtitle-position-design.md`

## Global Constraints

- Work only in the worktree `/Users/yujioyama/Site/teleprompter/.claude/worktrees/default-bgm` (branch `feat/default-bgm-subtitle-position`). Other sessions use the main checkout; never switch its branch.
- Type-check with `npx tsc -b` (`tsc --noEmit -p .` checks nothing in this repo).
- Tests: `npx vitest run <path>`; full suite `npx vitest run`. Lint: `npx eslint .`.
- Settings defaults, verbatim: `defaultBgmId: 'lofi-tokyo'`, `bgmVolume: 0.3`, `subtitlePosition: SUBTITLE_POSITION_BOTTOM`.
- UI copy, verbatim: `いつものBGM`, `BGMの音量`, `なし`, `▶ 試聴` / `■ 停止`, `字幕の位置`, `短い字幕`, `長い字幕`, `字幕の上下位置`, `いつものBGM（<title>）を合成中…`, `別のBGMを選ぶ`.
- Prepared audio is WebCodecs-only; without WebCodecs behaviour is unchanged.
- Max prepared-audio vs video duration mismatch: 0.05 s.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Match surrounding code: comments explain *why*, Japanese UI strings, CSS modules with existing tokens (`--surface`, `--surface2`, `--border`, `--text`, `--text-muted`, `--accent`).

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/hooks/useSettings.ts` | modify | new settings keys + `defaultBgmTrack()` |
| `src/utils/normalizeLoudness.ts` | modify | `markLoudnessNormalized()` |
| `src/utils/webcodecs/mixMusicWebCodecs.ts` | modify | export `renderMix` taking a decoded buffer |
| `src/utils/webcodecs/normalizeLoudnessWebCodecs.ts` | modify | export `applyTargetLoudness` |
| `src/utils/webcodecs/finalAudio.ts` | create | `prepareFinalAudio`, `joinVideoAndAudio`, `durationsMatch` |
| `src/utils/fetchTrack.ts` | create | per-session track fetch cache (moved out of MusicMixer) |
| `src/utils/preparedAudio.ts` | create | `PreparedAudio` holder, `mixForExport` |
| `src/data/musicTracks.ts` | modify | export `GENRE_ORDER` |
| `src/components/MusicPicker.tsx` | modify | open on the selected track's genre; use shared `GENRE_ORDER` |
| `src/components/MusicMixer.tsx` (+ test) | modify | initial track/volume, `autoMix`, `mix` prop |
| `src/components/SubtitleWorkflow.tsx` (+ test) | modify | auto-generate on mount, shared presets |
| `src/utils/subtitlePosition.ts` | modify | export `SUBTITLE_POSITION_PRESETS` |
| `src/data/subtitleSamples.ts` (+ test) | create | short/long sample cues |
| `src/components/BgmSettings.tsx` / `.module.css` | create | いつものBGM + 音量 |
| `src/components/SubtitlePositionSettings.tsx` / `.module.css` | create | two sample frames + slider |
| `src/pages/SettingsPage.tsx` (+ new test) | modify | mount the two sections |
| `src/pages/FinalizePage.tsx` (+ test) | modify | wire settings, auto BGM, prepared audio |

---

### Task 1: Settings keys

**Files:**
- Modify: `src/hooks/useSettings.ts`
- Test: `src/hooks/useSettings.test.ts`

**Interfaces:**
- Produces: `AppSettings.defaultBgmId: string | null`, `AppSettings.bgmVolume: number`, `AppSettings.subtitlePosition: number`; `defaultBgmTrack(settings: Pick<AppSettings, 'defaultBgmId'>): MusicTrack | null`.

- [ ] **Step 1: Write the failing tests**

In `src/hooks/useSettings.test.ts`, add after the imports:

```ts
import { defaultBgmTrack } from './useSettings'
import { SUBTITLE_POSITION_BOTTOM } from '../utils/subtitlePosition'

const DEFAULTS = {
  trimEnabled: true,
  trimPaddingStart: 0.3,
  trimPaddingEnd: 0.4,
  normalizeAudio: true,
  defaultBgmId: 'lofi-tokyo',
  bgmVolume: 0.3,
  subtitlePosition: SUBTITLE_POSITION_BOTTOM,
}
```

(Merge `defaultBgmTrack` into the existing `import { useSettings } from './useSettings'` line.) Replace the three exact-default `toEqual({...})` objects:
- in `returns defaults when localStorage is empty` → `expect(result.current[0]).toEqual(DEFAULTS)`
- in `falls back to defaults when localStorage contains invalid JSON` → `expect(result.current[0]).toEqual(DEFAULTS)`
- in `loads persisted settings on mount` → `expect(result.current[0]).toEqual({ ...DEFAULTS, trimEnabled: false, trimPaddingEnd: 1.2, normalizeAudio: false })`

Add inside the `describe`:

```ts
  it('stores the usual BGM, its volume and the subtitle position', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ defaultBgmId: null }) })
    act(() => { result.current[1]({ bgmVolume: 0.55 }) })
    act(() => { result.current[1]({ subtitlePosition: 64 }) })
    expect(result.current[0]).toMatchObject({ defaultBgmId: null, bgmVolume: 0.55, subtitlePosition: 64 })
    expect(JSON.parse(localStorage.getItem('teleprompter_settings')!)).toMatchObject({
      defaultBgmId: null,
      bgmVolume: 0.55,
      subtitlePosition: 64,
    })
  })

  it('gives stored settings from before these keys their defaults', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false }))
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toMatchObject({
      defaultBgmId: 'lofi-tokyo',
      bgmVolume: 0.3,
      subtitlePosition: SUBTITLE_POSITION_BOTTOM,
    })
  })
})

describe('defaultBgmTrack', () => {
  it('resolves the usual BGM to its track', () => {
    expect(defaultBgmTrack({ defaultBgmId: 'lofi-tokyo' })?.title).toBe('Tokyo Lofi')
  })

  it('treats none, or a track that no longer exists, as no BGM', () => {
    expect(defaultBgmTrack({ defaultBgmId: null })).toBeNull()
    expect(defaultBgmTrack({ defaultBgmId: 'removed-track' })).toBeNull()
  })
```

(The second `describe` reuses the final `})` that closed the first one — make sure braces balance.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/hooks/useSettings.test.ts`
Expected: FAIL — `defaultBgmTrack` is not exported / default objects lack the new keys.

- [ ] **Step 3: Implement**

`src/hooks/useSettings.ts`:

```ts
import { useState } from 'react'
import { MUSIC_TRACKS, MusicTrack } from '../data/musicTracks'
import { SUBTITLE_POSITION_BOTTOM } from '../utils/subtitlePosition'

export interface AppSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
  normalizeAudio: boolean
  /** BGM added to every video without stopping on the BGM step; null = none. */
  defaultBgmId: string | null
  /** 0-1, the BGM step's volume slider. */
  bgmVolume: number
  /** 0-100, where the subtitle step starts its position. */
  subtitlePosition: number
}

const STORAGE_KEY = 'teleprompter_settings'
const DEFAULTS: AppSettings = {
  trimEnabled: true,
  trimPaddingStart: 0.3,
  trimPaddingEnd: 0.4,
  normalizeAudio: true,
  defaultBgmId: 'lofi-tokyo',
  bgmVolume: 0.3,
  subtitlePosition: SUBTITLE_POSITION_BOTTOM,
}
```

Keep `loadSettings` and `useSettings` as they are, and append:

```ts
/** The usual BGM's track, or null when there is none or it has since been removed. */
export function defaultBgmTrack(settings: Pick<AppSettings, 'defaultBgmId'>): MusicTrack | null {
  return MUSIC_TRACKS.find(t => t.id === settings.defaultBgmId) ?? null
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/hooks/useSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSettings.ts src/hooks/useSettings.test.ts
git commit -m "feat: add usual BGM, BGM volume and subtitle position settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Let a blob skip the export loudness pass

**Files:**
- Modify: `src/utils/normalizeLoudness.ts`
- Test: `src/utils/normalizeLoudness.test.ts`

**Interfaces:**
- Produces: `markLoudnessNormalized(blob: Blob): void` — afterwards `normalizeLoudness(blob)` resolves to `blob` itself.

- [ ] **Step 1: Write the failing test**

Add `markLoudnessNormalized` to the existing import from `./normalizeLoudness`, then add a new `describe` at the end of the file:

```ts
describe('markLoudnessNormalized', () => {
  it('hands a blob already at the target straight back, without decoding it', async () => {
    vi.mocked(canUseWebCodecs).mockClear()
    const ready = new Blob(['already-normalized'], { type: 'video/mp4' })
    markLoudnessNormalized(ready)
    await expect(normalizeLoudness(ready)).resolves.toBe(ready)
    expect(canUseWebCodecs).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/normalizeLoudness.test.ts`
Expected: FAIL — `markLoudnessNormalized` is not a function.

- [ ] **Step 3: Implement**

In `src/utils/normalizeLoudness.ts`, right after `normalizeLoudness`:

```ts
/**
 * Record that `blob`'s audio was built at the target loudness already (see
 * preparedAudio.ts), so normalizeLoudness hands it back as is.
 */
export function markLoudnessNormalized(blob: Blob): void {
  results.set(blob, Promise.resolve(blob))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/utils/normalizeLoudness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/normalizeLoudness.ts src/utils/normalizeLoudness.test.ts
git commit -m "feat: let an already-normalized video skip the loudness pass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: WebCodecs final audio (prepare + join)

jsdom has no WebCodecs/AudioBuffer, so only the pure duration check is unit-tested here; the media functions are checked for real in Task 9 (browser) and on device.

**Files:**
- Modify: `src/utils/webcodecs/mixMusicWebCodecs.ts`
- Modify: `src/utils/webcodecs/normalizeLoudnessWebCodecs.ts`
- Create: `src/utils/webcodecs/finalAudio.ts`
- Test: `src/utils/webcodecs/finalAudio.test.ts`

**Interfaces:**
- Produces:
  - `renderMix(original: AudioBuffer, trackBlob: Blob, volume: number, duration: number): Promise<AudioBuffer>` (exported from `mixMusicWebCodecs.ts`)
  - `applyTargetLoudness(audio: AudioBuffer): boolean` (exported from `normalizeLoudnessWebCodecs.ts`)
  - `prepareFinalAudio(source: Blob, track: Blob, volume: number, normalize: boolean): Promise<Blob>` — audio-only M4A
  - `joinVideoAndAudio(video: Blob, audio: Blob): Promise<Blob>` — MP4, no re-encode
  - `durationsMatch(audio: number, video: number): boolean`, `MAX_DURATION_MISMATCH = 0.05`

- [ ] **Step 1: Write the failing test**

`src/utils/webcodecs/finalAudio.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { durationsMatch } from './finalAudio'

describe('durationsMatch', () => {
  it('accepts the few ms two encodes of the same cut can differ by', () => {
    expect(durationsMatch(12.0, 12.0)).toBe(true)
    expect(durationsMatch(12.03, 12.0)).toBe(true)
    expect(durationsMatch(11.96, 12.0)).toBe(true)
  })

  it('rejects audio built for a differently cut video', () => {
    expect(durationsMatch(12.2, 12.0)).toBe(false)
    expect(durationsMatch(11.0, 12.0)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/webcodecs/finalAudio.test.ts`
Expected: FAIL — cannot resolve `./finalAudio`.

- [ ] **Step 3: Refactor `renderMix` to take a decoded buffer**

In `src/utils/webcodecs/mixMusicWebCodecs.ts`, change the body of `mixMusicWebCodecs`:

```ts
    const duration = await input.computeDuration()
    const original = await decodeAudioTrack(audioTrack)
    const mixed = await renderMix(original, trackBlob, volume, duration)
    return await muxWithAudio(videoTrack, mixed)
```

and change `renderMix` to be exported and take the decoded audio (delete its first line `const original = await decodeAudioTrack(audioTrack)`; the rest of the body is unchanged):

```ts
/** The BGM mixed under `original`, as the ffmpeg filtergraph would (see above). */
export async function renderMix(
  original: AudioBuffer,
  trackBlob: Blob,
  volume: number,
  duration: number,
): Promise<AudioBuffer> {
  // `amix duration=first`: the output is as long as the original audio.
  const ctx = new OfflineAudioContext(original.numberOfChannels, original.length, original.sampleRate)
```

Remove `InputAudioTrack` from the mediabunny import: `renderMix` was its only user, and `noUnusedLocals` would fail `npx tsc -b`.

- [ ] **Step 4: Extract `applyTargetLoudness`**

In `src/utils/webcodecs/normalizeLoudnessWebCodecs.ts`, replace the four lines from `// getChannelData returns live views` to `applyGainWithLimiter(...)` with:

```ts
    const audio = await decodeAudioTrack(audioTrack)
    if (!applyTargetLoudness(audio)) return videoBlob
    return await muxWithAudio(videoTrack, audio)
```

and add below the function:

```ts
/**
 * Bring `audio` to the target loudness in place. Returns false, leaving it
 * untouched, when it already is there (or has no audible audio).
 */
export function applyTargetLoudness(audio: AudioBuffer): boolean {
  // getChannelData returns live views, so the gain lands in `audio` itself.
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
  const gainDb = planLoudnessGain(channels, audio.sampleRate)
  if (gainDb === null) return false
  applyGainWithLimiter(channels, audio.sampleRate, gainDb)
  return true
}
```

- [ ] **Step 5: Create `finalAudio.ts`**

`src/utils/webcodecs/finalAudio.ts`:

```ts
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny'
import { decodeAudioTrack } from './audioTrack'
import { renderMix } from './mixMusicWebCodecs'
import { applyTargetLoudness } from './normalizeLoudnessWebCodecs'
import { aacEncoderDelay } from './support'

/**
 * How far prepared audio may run from the video it's joined to. Two encodes
 * of the same trims differ by a frame at most; anything more means the
 * audio was built for another cut.
 */
export const MAX_DURATION_MISMATCH = 0.05

export function durationsMatch(audio: number, video: number): boolean {
  return Math.abs(audio - video) <= MAX_DURATION_MISMATCH
}

/**
 * The finished video's audio, built from `source` (the combined video,
 * before subtitles): the BGM mixed in as mixMusicWebCodecs does, then, if
 * `normalize`, brought to the export loudness as normalizeLoudnessWebCodecs
 * does. Returned encoded, as an audio-only M4A: the float buffer is ~23 MB a
 * minute, which iOS can't spare while burning subtitles (issue #12).
 */
export async function prepareFinalAudio(
  source: Blob,
  track: Blob,
  volume: number,
  normalize: boolean,
): Promise<Blob> {
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS })
  let audio: AudioBuffer
  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) throw new Error('video has no audio track')
    const duration = await input.computeDuration()
    audio = await renderMix(await decodeAudioTrack(audioTrack), track, volume, duration)
  } finally {
    input.dispose()
  }
  if (normalize) applyTargetLoudness(audio)
  return encodeAudioOnly(audio)
}

async function encodeAudioOnly(audio: AudioBuffer): Promise<Blob> {
  // Fed early by the encoder's priming delay, as muxWithAudio does, so the
  // audible start lands at 0 once the packets are copied next to the video.
  const source = new AudioBufferSource(
    { codec: 'aac', quality: new Quality('high') },
    { startTimestamp: -(await aacEncoderDelay()) },
  )
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  output.addAudioTrack(source)
  await output.start()
  try {
    await source.add(audio)
    source.close()
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => undefined)
    throw err
  }
  const buffer = output.target.buffer
  if (!buffer) throw new Error('prepared audio: no output')
  return new Blob([buffer], { type: 'audio/mp4' })
}

/**
 * An MP4 with `video`'s video packets and `audio`'s audio packets, both
 * copied as they are — no decoding or encoding. Throws when the two differ
 * in length by more than MAX_DURATION_MISMATCH, so the caller can mix the
 * slow way instead.
 */
export async function joinVideoAndAudio(video: Blob, audio: Blob): Promise<Blob> {
  const videoInput = new Input({ source: new BlobSource(video), formats: ALL_FORMATS })
  const audioInput = new Input({ source: new BlobSource(audio), formats: ALL_FORMATS })
  try {
    const videoTrack = await videoInput.getPrimaryVideoTrack()
    const audioTrack = await audioInput.getPrimaryAudioTrack()
    if (!videoTrack || !audioTrack) throw new Error('join: missing the video or the prepared audio')

    const videoDuration = await videoTrack.computeDuration()
    const audioDuration = await audioTrack.computeDuration()
    if (!durationsMatch(audioDuration, videoDuration)) {
      throw new Error(`join: prepared audio is ${audioDuration.toFixed(3)}s, video is ${videoDuration.toFixed(3)}s`)
    }

    const videoCodec = videoTrack.codec
    const audioCodec = audioTrack.codec
    const videoConfig = await videoTrack.getDecoderConfig()
    const audioConfig = await audioTrack.getDecoderConfig()
    if (!videoCodec || !audioCodec || !videoConfig || !audioConfig) throw new Error('join: unsupported track')

    const videoSource = new EncodedVideoPacketSource(videoCodec)
    const audioSource = new EncodedAudioPacketSource(audioCodec)
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
    output.addVideoTrack(videoSource, { rotation: await videoTrack.getRotation() })
    output.addAudioTrack(audioSource)
    await output.start()
    try {
      await Promise.all([
        (async () => {
          let first = true
          for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
            await videoSource.add(packet, first ? { decoderConfig: videoConfig } : undefined)
            first = false
          }
          videoSource.close()
        })(),
        (async () => {
          let first = true
          for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
            await audioSource.add(packet, first ? { decoderConfig: audioConfig } : undefined)
            first = false
          }
          audioSource.close()
        })(),
      ])
      await output.finalize()
    } catch (err) {
      await output.cancel().catch(() => undefined)
      throw err
    }
    const buffer = output.target.buffer
    if (!buffer || buffer.byteLength < 1000) {
      throw new Error(`join: suspiciously small output (${buffer?.byteLength ?? 0} bytes)`)
    }
    return new Blob([buffer], { type: 'video/mp4' })
  } finally {
    videoInput.dispose()
    audioInput.dispose()
  }
}
```

If `npx tsc -b` reports `computeDuration` missing on `InputTrack`, use `await videoInput.computeDuration()` / `await audioInput.computeDuration()` instead (whole-file durations; same values here since each file has the one relevant track — the video file's audio track ends with its video).

- [ ] **Step 6: Run tests and type-check**

Run: `npx vitest run src/utils/webcodecs/finalAudio.test.ts src/utils/mixMusic.test.ts src/utils/normalizeLoudness.test.ts && npx tsc -b`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/webcodecs/
git commit -m "feat: build the final BGM audio ahead and join it to a video by packet copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: PreparedAudio holder and mixForExport

**Files:**
- Create: `src/utils/fetchTrack.ts`
- Create: `src/utils/preparedAudio.ts`
- Test: `src/utils/preparedAudio.test.ts`

**Interfaces:**
- Consumes: `prepareFinalAudio`, `joinVideoAndAudio` (Task 3); `markLoudnessNormalized` (Task 2); `mixMusic(video, track, volume)` (existing).
- Produces:
  - `fetchTrack(track: MusicTrack): Promise<Blob>`
  - `interface FinalAudioKey { trackId: string; volume: number; normalize: boolean }`
  - `class PreparedAudio { prepare(source: Blob, key: FinalAudioKey, track: () => Promise<Blob>): void; get(source: Blob, key: FinalAudioKey): Promise<Blob> | null; clear(): void }`
  - `mixForExport(prepared: PreparedAudio, source: Blob, video: Blob, trackBlob: Blob, key: FinalAudioKey): Promise<Blob>`

- [ ] **Step 1: Write the failing tests**

`src/utils/preparedAudio.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PreparedAudio, mixForExport, type FinalAudioKey } from './preparedAudio'
import { mixMusic } from './mixMusic'
import { markLoudnessNormalized } from './normalizeLoudness'
import { joinVideoAndAudio, prepareFinalAudio } from './webcodecs/finalAudio'

vi.mock('./mixMusic', () => ({ mixMusic: vi.fn() }))
vi.mock('./normalizeLoudness', () => ({ markLoudnessNormalized: vi.fn() }))
vi.mock('./webcodecs/finalAudio', () => ({ prepareFinalAudio: vi.fn(), joinVideoAndAudio: vi.fn() }))

const COMBINED = new Blob(['combined'], { type: 'video/mp4' })
const BURNED = new Blob(['burned'], { type: 'video/mp4' })
const TRACK = new Blob(['track'], { type: 'audio/mpeg' })
const PREPARED = new Blob(['prepared'], { type: 'audio/mp4' })
const JOINED = new Blob(['joined'], { type: 'video/mp4' })
const MIXED = new Blob(['mixed'], { type: 'video/mp4' })
const KEY: FinalAudioKey = { trackId: 'lofi-tokyo', volume: 0.3, normalize: true }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prepareFinalAudio).mockResolvedValue(PREPARED)
  vi.mocked(joinVideoAndAudio).mockResolvedValue(JOINED)
  vi.mocked(mixMusic).mockResolvedValue(MIXED)
})

describe('PreparedAudio', () => {
  it('builds the audio once per source and key', async () => {
    const prepared = new PreparedAudio()
    const track = vi.fn(async () => TRACK)
    prepared.prepare(COMBINED, KEY, track)
    prepared.prepare(COMBINED, { ...KEY }, track)
    await expect(prepared.get(COMBINED, KEY)).resolves.toBe(PREPARED)
    expect(prepareFinalAudio).toHaveBeenCalledTimes(1)
    expect(prepareFinalAudio).toHaveBeenCalledWith(COMBINED, TRACK, 0.3, true)
  })

  it('has nothing for another source or key', () => {
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    expect(prepared.get(BURNED, KEY)).toBeNull()
    expect(prepared.get(COMBINED, { ...KEY, volume: 0.5 })).toBeNull()
    expect(prepared.get(COMBINED, { ...KEY, trackId: 'summer-pop' })).toBeNull()
    expect(prepared.get(COMBINED, { ...KEY, normalize: false })).toBeNull()
  })

  it('forgets its result on clear', () => {
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    prepared.clear()
    expect(prepared.get(COMBINED, KEY)).toBeNull()
  })
})

describe('mixForExport', () => {
  it('joins the burned video with the prepared audio, already at the export loudness', async () => {
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    await expect(mixForExport(prepared, COMBINED, BURNED, TRACK, KEY)).resolves.toBe(JOINED)
    expect(joinVideoAndAudio).toHaveBeenCalledWith(BURNED, PREPARED)
    expect(markLoudnessNormalized).toHaveBeenCalledWith(JOINED)
    expect(mixMusic).not.toHaveBeenCalled()
  })

  it('leaves the loudness pass to the export step when the key did not normalize', async () => {
    const key = { ...KEY, normalize: false }
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, key, async () => TRACK)
    await mixForExport(prepared, COMBINED, BURNED, TRACK, key)
    expect(markLoudnessNormalized).not.toHaveBeenCalled()
  })

  it('mixes as before when nothing was prepared for this choice', async () => {
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    const other = { ...KEY, volume: 0.6 }
    await expect(mixForExport(prepared, COMBINED, BURNED, TRACK, other)).resolves.toBe(MIXED)
    expect(mixMusic).toHaveBeenCalledWith(BURNED, TRACK, 0.6)
    expect(joinVideoAndAudio).not.toHaveBeenCalled()
  })

  it('mixes as before when preparing failed', async () => {
    vi.mocked(prepareFinalAudio).mockRejectedValueOnce(new Error('decode failed'))
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    await expect(mixForExport(prepared, COMBINED, BURNED, TRACK, KEY)).resolves.toBe(MIXED)
  })

  it('mixes as before when the join fails', async () => {
    vi.mocked(joinVideoAndAudio).mockRejectedValueOnce(new Error('length mismatch'))
    const prepared = new PreparedAudio()
    prepared.prepare(COMBINED, KEY, async () => TRACK)
    await expect(mixForExport(prepared, COMBINED, BURNED, TRACK, KEY)).resolves.toBe(MIXED)
    expect(markLoudnessNormalized).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/preparedAudio.test.ts`
Expected: FAIL — cannot resolve `./preparedAudio`.

- [ ] **Step 3: Create `fetchTrack.ts`**

`src/utils/fetchTrack.ts` (moved verbatim from `MusicMixer.tsx`; MusicMixer switches to it in Task 5):

```ts
import { MusicTrack } from '../data/musicTracks'

// Each track's file, fetched once per session and shared by the live
// preview, the real mix and the audio prepared ahead of it.
const trackBlobs = new Map<string, Promise<Blob>>()

export function fetchTrack(track: MusicTrack): Promise<Blob> {
  let blob = trackBlobs.get(track.id)
  if (!blob) {
    blob = fetch(`/${track.file}`).then(response => {
      if (!response.ok) throw new Error(`「${track.title}」の読み込みに失敗しました`)
      return response.blob()
    })
    trackBlobs.set(track.id, blob)
    blob.catch(() => trackBlobs.delete(track.id))
  }
  return blob
}
```

- [ ] **Step 4: Create `preparedAudio.ts`**

`src/utils/preparedAudio.ts`:

```ts
import { mixMusic } from './mixMusic'
import { markLoudnessNormalized } from './normalizeLoudness'
import { joinVideoAndAudio, prepareFinalAudio } from './webcodecs/finalAudio'

/** Everything the finished audio depends on besides the video's own sound. */
export interface FinalAudioKey {
  trackId: string
  volume: number
  normalize: boolean
}

function sameKey(a: FinalAudioKey, b: FinalAudioKey): boolean {
  return a.trackId === b.trackId && a.volume === b.volume && a.normalize === b.normalize
}

/**
 * The finished video's audio (BGM mixed in, loudness corrected), built from
 * the combined video while the subtitles are still being worked on:
 * subtitles only change the picture, so the audio needn't wait for the
 * burn. Holds one result at a time.
 */
export class PreparedAudio {
  private entry: { source: Blob; key: FinalAudioKey; audio: Promise<Blob> } | null = null

  prepare(source: Blob, key: FinalAudioKey, track: () => Promise<Blob>): void {
    if (this.entry && this.entry.source === source && sameKey(this.entry.key, key)) return
    const audio = track().then(blob => prepareFinalAudio(source, blob, key.volume, key.normalize))
    // Only means mixing the slow way later; never shown to the user.
    audio.catch(err => console.warn('[PreparedAudio] could not prepare the final audio:', err))
    this.entry = { source, key, audio }
  }

  get(source: Blob, key: FinalAudioKey): Promise<Blob> | null {
    if (!this.entry || this.entry.source !== source || !sameKey(this.entry.key, key)) return null
    return this.entry.audio
  }

  clear(): void {
    this.entry = null
  }
}

/**
 * Add the BGM to `video`, the burned version of `source`: by joining it with
 * audio prepared for exactly this source and choice when there is some,
 * otherwise by mixing as before. A joined video's loudness is already
 * corrected when `key.normalize`, so the export step won't redo it.
 */
export async function mixForExport(
  prepared: PreparedAudio,
  source: Blob,
  video: Blob,
  trackBlob: Blob,
  key: FinalAudioKey,
): Promise<Blob> {
  const audio = prepared.get(source, key)
  if (audio) {
    try {
      const joined = await joinVideoAndAudio(video, await audio)
      if (key.normalize) markLoudnessNormalized(joined)
      return joined
    } catch (err) {
      console.warn('[mixForExport] prepared audio unusable, mixing instead:', err)
    }
  }
  return mixMusic(video, trackBlob, key.volume)
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/utils/preparedAudio.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/fetchTrack.ts src/utils/preparedAudio.ts src/utils/preparedAudio.test.ts
git commit -m "feat: hold the prepared BGM audio and use it when adding BGM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: MusicMixer — usual BGM pre-picked, auto mix, injectable mix

**Files:**
- Modify: `src/data/musicTracks.ts`
- Modify: `src/components/MusicPicker.tsx`
- Modify: `src/components/MusicMixer.tsx`
- Test: `src/components/MusicMixer.test.tsx`

**Interfaces:**
- Consumes: `fetchTrack` (Task 4).
- Produces: `GENRE_ORDER: MusicGenre[]` exported from `musicTracks.ts`; new optional `MusicMixer` props `initialTrackId?: string | null`, `initialVolume?: number`, `autoMix?: boolean`, `mix?: (track: MusicTrack, trackBlob: Blob, volume: number) => Promise<Blob>`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('MusicMixer', ...)` in `src/components/MusicMixer.test.tsx`:

```tsx
  it('opens with the usual BGM and volume already picked', () => {
    render(
      <MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} initialTrackId="lofi-tokyo" initialVolume={0.45} />,
    )
    expect(screen.getByRole('combobox', { name: 'ジャンル' })).toHaveValue('lofi')
    expect(screen.getByText('Tokyo Lofi').closest('div')?.className).toMatch(/trackRowSelected/)
    expect(screen.getByRole('slider')).toHaveValue('0.45')
    expect(nextButton()).not.toBeDisabled()
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })

  it('mixes the usual BGM on arrival when autoMix is on, then moves on', async () => {
    const onMixed = vi.fn()
    const onNext = vi.fn()
    const mixed = new Blob(['auto-mixed'], { type: 'video/mp4' })
    vi.mocked(mixModule.mixMusic).mockResolvedValueOnce(mixed)
    render(
      <MusicMixer
        videoBlob={VIDEO_BLOB}
        onMixed={onMixed}
        onNext={onNext}
        initialTrackId="lofi-tokyo"
        initialVolume={0.45}
        autoMix
      />,
    )

    expect(screen.getByText('いつものBGM（Tokyo Lofi）を合成中…')).toBeInTheDocument()
    expect(screen.queryByText('BGMなしで進む')).not.toBeInTheDocument()
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
    const [video, , volume] = vi.mocked(mixModule.mixMusic).mock.calls[0]
    expect(video).toBe(VIDEO_BLOB)
    expect(volume).toBe(0.45)
    expect(onMixed).toHaveBeenCalledWith(mixed)
  })

  it('drops the auto mix and shows the picker on 別のBGMを選ぶ', async () => {
    const onMixed = vi.fn()
    const onNext = vi.fn()
    let resolveMix: (blob: Blob) => void = () => {}
    vi.mocked(mixModule.mixMusic).mockImplementationOnce(() => new Promise<Blob>(resolve => (resolveMix = resolve)))
    render(
      <MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={onNext} initialTrackId="lofi-tokyo" autoMix />,
    )
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('別のBGMを選ぶ'))
    resolveMix(new Blob(['late'], { type: 'video/mp4' }))
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(screen.getByText('BGMなしで進む')).toBeInTheDocument()
    expect(screen.getByText('Tokyo Lofi').closest('div')?.className).toMatch(/trackRowSelected/)
    expect(onMixed).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('shows the picker with the error when the auto mix fails', async () => {
    const onNext = vi.fn()
    vi.mocked(mixModule.mixMusic).mockRejectedValueOnce(new Error('boom'))
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={onNext} initialTrackId="lofi-tokyo" autoMix />)

    expect(await screen.findByText(/「Tokyo Lofi」の合成に失敗しました: boom/)).toBeInTheDocument()
    expect(screen.getByText('BGMなしで進む')).toBeInTheDocument()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('does nothing automatically when autoMix has no usual BGM', () => {
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} initialTrackId={null} autoMix />)
    expect(screen.getByText('BGMなしで進む')).toBeInTheDocument()
    expect(nextButton()).toBeDisabled()
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })

  it('mixes through the given mix function when there is one', async () => {
    const onMixed = vi.fn()
    const joined = new Blob(['joined'], { type: 'video/mp4' })
    const mix = vi.fn(async () => joined)
    render(
      <MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={vi.fn()} initialTrackId="lofi-tokyo" mix={mix} />,
    )
    fireEvent.click(nextButton())

    await waitFor(() => expect(onMixed).toHaveBeenCalledWith(joined))
    const [track, trackBlob, volume] = mix.mock.calls[0] as unknown as [{ id: string }, Blob, number]
    expect(track.id).toBe('lofi-tokyo')
    expect(trackBlob).toBeInstanceOf(Blob)
    expect(volume).toBe(0.3)
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/MusicMixer.test.tsx`
Expected: the six new tests FAIL (props ignored); the old ones PASS.

- [ ] **Step 3: Share `GENRE_ORDER` and open the picker on the picked genre**

In `src/data/musicTracks.ts`, after `GENRE_LABELS`:

```ts
/** Order genres are offered in. */
export const GENRE_ORDER: MusicGenre[] = ['lofi', 'pop', 'cinematic', 'corporate']
```

In `src/components/MusicPicker.tsx`: change the import to `import { MusicTrack, GENRE_LABELS, GENRE_ORDER, MusicGenre } from '../data/musicTracks'`, delete the local `const GENRE_ORDER ...` line, and change the genre state initializer to:

```tsx
  const [genre, setGenre] = useState<MusicGenre>(
    () =>
      tracks.find(t => t.id === selectedId)?.genre ??
      GENRE_ORDER.find(g => tracks.some(t => t.genre === g)) ??
      GENRE_ORDER[0]
  )
```

- [ ] **Step 4: Rewrite `MusicMixer.tsx`**

Replace the whole file with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { MUSIC_TRACKS, MusicTrack } from '../data/musicTracks'
import { mixMusic } from '../utils/mixMusic'
import { fetchTrack } from '../utils/fetchTrack'
import { BgmPreview } from '../utils/bgmPreview'
import MusicPicker from './MusicPicker'
import styles from './MusicMixer.module.css'

interface MusicMixerProps {
  videoBlob: Blob
  onMixed: (blob: Blob | null) => void
  onNext: () => void
  /** Track and volume the picker opens with: the usual BGM from settings. */
  initialTrackId?: string | null
  initialVolume?: number
  /** Mix the initial track straight away and move on, without a tap. */
  autoMix?: boolean
  /** How a picked track is added; defaults to mixMusic onto `videoBlob`. */
  mix?: (track: MusicTrack, trackBlob: Blob, volume: number) => Promise<Blob>
}

// 'auto': mixing the usual BGM on arrival, picker hidden.
type Stage = 'idle' | 'mixing' | 'auto' | 'error'

export default function MusicMixer({
  videoBlob,
  onMixed,
  onNext,
  initialTrackId = null,
  initialVolume = 0.3,
  autoMix = false,
  mix,
}: MusicMixerProps) {
  const initialTrack = MUSIC_TRACKS.find(t => t.id === initialTrackId) ?? null
  const [selectedId, setSelectedId] = useState<string | null>(initialTrack?.id ?? null)
  const [volume, setVolume] = useState(initialVolume)
  const [stage, setStage] = useState<Stage>(autoMix && initialTrack ? 'auto' : 'idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<BgmPreview | null>(null)
  // Bumped when the component unmounts, the user skips or picks another
  // BGM, so a mix still running then is discarded instead of re-adding BGM
  // afterwards.
  const requestIdRef = useRef(0)

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
    }
  }, [])

  // On arrival only. StrictMode's simulated remount discards the first run
  // (the unmount effect above bumps requestIdRef) and starts a fresh one.
  useEffect(() => {
    if (autoMix && initialTrack) void runMix(initialTrack, initialVolume, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Created and revoked in the same effect so StrictMode's simulated
  // remount never leaves the player on a revoked URL (see SubtitleWorkflow).
  useEffect(() => {
    const url = URL.createObjectURL(videoBlob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [videoBlob])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const preview = new BgmPreview(video)
    previewRef.current = preview
    return () => {
      preview.dispose()
      previewRef.current = null
    }
  }, [])

  useEffect(() => {
    previewRef.current?.setVolume(volume)
  }, [volume])

  useEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    const track = MUSIC_TRACKS.find(t => t.id === selectedId)
    if (!track) {
      void preview.setTrack(null)
      return
    }
    let cancelled = false
    fetchTrack(track).then(
      blob => {
        if (!cancelled) void preview.setTrack(blob)
      },
      err => console.warn('[MusicMixer] could not load the track for preview:', err),
    )
    return () => {
      cancelled = true
    }
  }, [selectedId])

  if (MUSIC_TRACKS.length === 0) return null

  async function runMix(track: MusicTrack, mixVolume: number, auto: boolean) {
    videoRef.current?.pause()
    const requestId = ++requestIdRef.current
    setStage(auto ? 'auto' : 'mixing')
    setErrorMessage(null)
    try {
      const trackBlob = await fetchTrack(track)
      const mixed = await (mix ? mix(track, trackBlob, mixVolume) : mixMusic(videoBlob, trackBlob, mixVolume))
      if (requestIdRef.current !== requestId) return
      onMixed(mixed)
      onNext()
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      const detail = err instanceof Error ? err.message : String(err)
      setErrorMessage(`「${track.title}」の合成に失敗しました: ${detail}`)
      setStage('error')
    }
  }

  function handleSelect(id: string | null) {
    // A tap: the only moment iOS lets the preview's audio start.
    previewRef.current?.unlock()
    setSelectedId(id)
    setErrorMessage(null)
    if (stage === 'error') setStage('idle')
  }

  function handleNext() {
    const track = MUSIC_TRACKS.find(t => t.id === selectedId)
    if (track) void runMix(track, volume, false)
  }

  function handleChooseOther() {
    requestIdRef.current += 1
    setStage('idle')
  }

  function handleSkip() {
    requestIdRef.current += 1
    videoRef.current?.pause()
    onMixed(null)
    onNext()
  }

  const mixing = stage === 'mixing'
  const auto = stage === 'auto'

  return (
    <div className={styles.wrapper}>
      {auto ? (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>BGM</p>
          <p className={styles.status}>いつものBGM（{initialTrack?.title}）を合成中…</p>
          <button className={styles.skipBtn} onClick={handleChooseOther}>
            別のBGMを選ぶ
          </button>
        </div>
      ) : (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>BGMを追加</p>
          <MusicPicker
            tracks={MUSIC_TRACKS}
            selectedId={selectedId}
            onSelect={handleSelect}
            volume={volume}
            onVolumeChange={setVolume}
          />
          {stage === 'error' && errorMessage && <p className={styles.error}>{errorMessage}</p>}
        </div>
      )}

      {/* Kept mounted while auto-mixing: BgmPreview attaches to it once, on mount. */}
      <div className={styles.section} style={auto ? { display: 'none' } : undefined}>
        <p className={styles.sectionTitle}>プレビュー</p>
        <video
          ref={videoRef}
          className={styles.preview}
          src={previewUrl ?? undefined}
          controls={!mixing}
          playsInline
        />
        {selectedId && <p className={styles.status}>再生するとBGMを重ねて確認できます</p>}
      </div>

      {!auto && (
        <div className={styles.actions}>
          {/* Left enabled while mixing, to give up on a slow mix. */}
          <button className={styles.skipBtn} onClick={handleSkip}>
            BGMなしで進む
          </button>
          <button className={styles.mixBtn} onClick={handleNext} disabled={!selectedId || mixing}>
            {mixing ? 'BGMを合成中...' : '次へ'}
          </button>
        </div>
      )}
    </div>
  )
}
```

Note `runMix` is a function declaration after the early `return null`; the mount effect calls it after render, so it is defined by then — but ESLint/TS may flag use-before-define inside the effect. If they do, move the `if (MUSIC_TRACKS.length === 0) return null` line to just before the `return (` JSX (after all functions), which keeps the hooks order unchanged.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/components/MusicMixer.test.tsx src/components/MusicPicker.test.tsx`
Expected: PASS (old and new tests).

- [ ] **Step 6: Commit**

```bash
git add src/data/musicTracks.ts src/components/MusicPicker.tsx src/components/MusicMixer.tsx src/components/MusicMixer.test.tsx
git commit -m "feat: let the BGM step open on the usual BGM and mix it without a tap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Generate the English subtitles on arrival

**Files:**
- Modify: `src/components/SubtitleWorkflow.tsx`
- Modify: `src/utils/subtitlePosition.ts`
- Test: `src/components/SubtitleWorkflow.test.tsx`, `src/pages/FinalizePage.test.tsx`

**Interfaces:**
- Produces: `SUBTITLE_POSITION_PRESETS: { label: string; value: SubtitlePosition }[]` from `subtitlePosition.ts` (used again in Task 7).

- [ ] **Step 1: Update the tests to the new behaviour**

Remove every generate-button click (the cues now exist on arrival):

```bash
sed -i '' "/fireEvent.click(screen.getByText('📝 英語字幕を生成'))/d" src/components/SubtitleWorkflow.test.tsx
sed -i '' "/fireEvent.click(await screen.findByText('📝 英語字幕を生成'))/d" src/pages/FinalizePage.test.tsx
```

Then in `src/components/SubtitleWorkflow.test.tsx`, in the empty-text test, replace

```tsx
    expect(screen.getByText(/字幕にできるテキストがありません/)).toBeInTheDocument()
    expect(screen.getByText('📝 英語字幕を生成')).toBeInTheDocument()
```

with

```tsx
    expect(screen.getByText(/字幕にできるテキストがありません/)).toBeInTheDocument()
    expect(screen.queryByText('📝 英語字幕を生成')).not.toBeInTheDocument()
```

and add a test inside the first `describe`:

```tsx
  it('generates the English subtitles on arrival, without a button', async () => {
    render(<ControlledSubtitleWorkflow combinedBlob={BLOB} shotCueInputs={SHOT_CUE_INPUTS} onBurned={vi.fn()} />)
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
    expect(screen.queryByText('📝 英語字幕を生成')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx`
Expected: FAIL — cues never appear (nothing generates them).

- [ ] **Step 3: Implement**

In `src/utils/subtitlePosition.ts`, append:

```ts
/** The one-tap positions offered next to the fine-tune slider. */
export const SUBTITLE_POSITION_PRESETS: { label: string; value: SubtitlePosition }[] = [
  { label: '上部', value: SUBTITLE_POSITION_TOP },
  { label: '中央', value: SUBTITLE_POSITION_CENTER },
  { label: '下部', value: SUBTITLE_POSITION_BOTTOM },
]
```

In `src/components/SubtitleWorkflow.tsx`:
1. Change the position import to:
   ```ts
   import { SubtitlePosition, SUBTITLE_POSITION_BOTTOM, SUBTITLE_POSITION_PRESETS } from '../utils/subtitlePosition'
   ```
2. Delete the local `const PRESETS ... = [...]` block and change `{PRESETS.map(p => (` to `{SUBTITLE_POSITION_PRESETS.map(p => (`.
3. After the `burnAbortRef` unmount effect (`useEffect(() => { return () => burnAbortRef.current?.abort() }, [])`), add:
   ```tsx
     // The English cues come straight from the script and trims, so there is
     // nothing to wait for: build them on arrival. Only then — coming back
     // to this step keeps the cues (and edits) already there.
     useEffect(() => {
       if (stage === 'idle' && cues.length === 0) handleGenerate()
       // eslint-disable-next-line react-hooks/exhaustive-deps
     }, [])
   ```
4. Delete the idle-stage button:
   ```tsx
         {stage === 'idle' && (
           <button className={styles.genBtn} onClick={handleGenerate}>
             📝 英語字幕を生成
           </button>
         )}
   ```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx src/pages/FinalizePage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SubtitleWorkflow.tsx src/components/SubtitleWorkflow.test.tsx src/utils/subtitlePosition.ts src/pages/FinalizePage.test.tsx
git commit -m "feat: generate the English subtitles on arriving at the subtitle step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Settings — usual BGM and subtitle position

**Files:**
- Create: `src/data/subtitleSamples.ts`, `src/data/subtitleSamples.test.ts`
- Create: `src/components/BgmSettings.tsx`, `src/components/BgmSettings.module.css`
- Create: `src/components/SubtitlePositionSettings.tsx`, `src/components/SubtitlePositionSettings.module.css`
- Modify: `src/pages/SettingsPage.tsx`
- Test: `src/pages/SettingsPage.test.tsx` (new)

**Interfaces:**
- Consumes: `AppSettings` keys (Task 1), `GENRE_ORDER` (Task 5), `SUBTITLE_POSITION_PRESETS` (Task 6), `SubtitleOverlayPreview` (existing: `{ cues, position, currentTime }`).
- Produces: `SUBTITLE_SAMPLES: { label: string; cue: SubtitleCue }[]`; `<BgmSettings trackId volume onChange />`; `<SubtitlePositionSettings position onChange />`.

- [ ] **Step 1: Write the failing tests**

`src/data/subtitleSamples.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SUBTITLE_SAMPLES } from './subtitleSamples'
import { createCanvasMeasure, layoutCue } from '../utils/subtitleLayout'

const measure = createCanvasMeasure()
const lineCounts = (label: string) => {
  const layout = layoutCue(SUBTITLE_SAMPLES.find(s => s.label === label)!.cue, measure)
  return [layout.en.lines.length, layout.ja?.lines.length]
}

describe('SUBTITLE_SAMPLES', () => {
  it('has a one-line sample in both languages', () => {
    expect(lineCounts('短い字幕')).toEqual([1, 1])
  })

  it('has a sample as tall as a cue gets: three lines in both languages', () => {
    expect(lineCounts('長い字幕')).toEqual([3, 3])
  })
})
```

`src/pages/SettingsPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SettingsPage from './SettingsPage'

function stored() {
  return JSON.parse(localStorage.getItem('teleprompter_settings') ?? '{}')
}

function renderSettings() {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('SettingsPage BGM', () => {
  it('starts on Tokyo Lofi at 30%', () => {
    renderSettings()
    expect(screen.getByRole('combobox', { name: 'いつものBGM' })).toHaveValue('lofi-tokyo')
    expect(screen.getByRole('slider', { name: 'BGMの音量' })).toHaveValue('0.3')
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('saves the usual BGM and its volume', () => {
    renderSettings()
    fireEvent.change(screen.getByRole('combobox', { name: 'いつものBGM' }), { target: { value: 'summer-pop' } })
    fireEvent.change(screen.getByRole('slider', { name: 'BGMの音量' }), { target: { value: '0.5' } })
    expect(stored()).toMatchObject({ defaultBgmId: 'summer-pop', bgmVolume: 0.5 })
  })

  it('saves なし as no BGM, and disables the volume and preview', () => {
    renderSettings()
    fireEvent.change(screen.getByRole('combobox', { name: 'いつものBGM' }), { target: { value: '' } })
    expect(stored().defaultBgmId).toBeNull()
    expect(screen.getByRole('slider', { name: 'BGMの音量' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '▶ 試聴' })).toBeDisabled()
  })
})

describe('SettingsPage subtitle position', () => {
  it('shows the short and long samples together, both languages', () => {
    renderSettings()
    expect(screen.getByText('短い字幕')).toBeInTheDocument()
    expect(screen.getByText('長い字幕')).toBeInTheDocument()
    expect(screen.getAllByTestId('subtitle-overlay-box')).toHaveLength(2)
    expect(screen.getByText('さあ、始めましょう！')).toBeInTheDocument()
  })

  it('moves both samples and saves the position from the slider', () => {
    renderSettings()
    fireEvent.change(screen.getByRole('slider', { name: '字幕の上下位置' }), { target: { value: '64' } })
    expect(stored().subtitlePosition).toBe(64)
    for (const box of screen.getAllByTestId('subtitle-overlay-box')) expect(box.style.top).toBe('64%')
  })

  it('sets a preset position with one tap', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: '上部' }))
    expect(stored().subtitlePosition).toBe(13.75)
    expect(screen.getByRole('button', { name: '上部' })).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/data/subtitleSamples.test.ts src/pages/SettingsPage.test.tsx`
Expected: FAIL — modules/sections missing.

- [ ] **Step 3: Sample cues**

`src/data/subtitleSamples.ts`:

```ts
import { SubtitleCue } from '../utils/subtitleCues'

export interface SubtitleSample {
  label: string
  cue: SubtitleCue
}

// Set side by side when choosing the default subtitle position: cues grow
// up and down from the position, so it has to suit both the shortest cue
// and the tallest one (three lines in each language, the layout maximum).
export const SUBTITLE_SAMPLES: SubtitleSample[] = [
  {
    label: '短い字幕',
    cue: { id: 'sample-short', start: 0, end: 1, en: "Let's get started!", ja: 'さあ、始めましょう！' },
  },
  {
    label: '長い字幕',
    cue: {
      id: 'sample-long',
      start: 0,
      end: 1,
      en: 'Today I want to share three simple habits that completely changed my mornings.',
      ja: '今日は、私の朝をがらっと変えてくれた、シンプルな三つの習慣について紹介したいと思います。',
    },
  },
]
```

- [ ] **Step 4: BgmSettings**

`src/components/BgmSettings.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { GENRE_LABELS, GENRE_ORDER, MUSIC_TRACKS } from '../data/musicTracks'
import type { AppSettings } from '../hooks/useSettings'
import styles from './BgmSettings.module.css'

interface BgmSettingsProps {
  trackId: string | null
  volume: number
  onChange: (patch: Partial<Pick<AppSettings, 'defaultBgmId' | 'bgmVolume'>>) => void
}

export default function BgmSettings({ trackId, volume, onChange }: BgmSettingsProps) {
  const track = MUSIC_TRACKS.find(t => t.id === trackId) ?? null
  const [previewing, setPreviewing] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => () => audioRef.current?.pause(), [])

  function stopPreview() {
    audioRef.current?.pause()
    setPreviewing(false)
  }

  function togglePreview() {
    if (!track) return
    if (previewing) {
      stopPreview()
      return
    }
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener('ended', () => setPreviewing(false))
    }
    audioRef.current.src = `/${track.file}`
    void audioRef.current.play()
    setPreviewing(true)
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.field}>
        <div className={styles.label}>いつものBGM</div>
        <div className={styles.sub}>仕上げで自動的に付けます（動画ごとに変更も可）</div>
        <div className={styles.trackRow}>
          <select
            aria-label="いつものBGM"
            className={styles.select}
            value={track?.id ?? ''}
            onChange={e => {
              stopPreview()
              onChange({ defaultBgmId: e.target.value || null })
            }}
          >
            <option value="">なし</option>
            {GENRE_ORDER.map(genre => (
              <optgroup key={genre} label={GENRE_LABELS[genre]}>
                {MUSIC_TRACKS.filter(t => t.genre === genre).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" className={styles.previewBtn} onClick={togglePreview} disabled={!track}>
            {previewing ? '■ 停止' : '▶ 試聴'}
          </button>
        </div>
      </div>

      <div className={`${styles.field} ${!track ? styles.disabled : ''}`}>
        <div className={styles.header}>
          <span className={styles.label}>BGMの音量</span>
          <span className={styles.value}>{Math.round(volume * 100)}%</span>
        </div>
        <input
          aria-label="BGMの音量"
          className={styles.slider}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          disabled={!track}
          onChange={e => onChange({ bgmVolume: parseFloat(e.target.value) })}
        />
      </div>
    </div>
  )
}
```

`src/components/BgmSettings.module.css`:

```css
.wrapper {
  display: flex;
  flex-direction: column;
}

.field {
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}

.label {
  font-size: 1rem;
  color: var(--text);
}

.sub {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.trackRow {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.select {
  flex: 1;
  min-width: 0;
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 0.9rem;
}

.previewBtn {
  background: var(--surface2);
  color: var(--text);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.8rem;
  white-space: nowrap;
}

.previewBtn:disabled {
  opacity: 0.4;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.value {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.slider {
  width: 100%;
  margin-top: 10px;
}

.disabled {
  opacity: 0.4;
}
```

- [ ] **Step 5: SubtitlePositionSettings**

`src/components/SubtitlePositionSettings.tsx`:

```tsx
import { SUBTITLE_SAMPLES } from '../data/subtitleSamples'
import { SUBTITLE_POSITION_PRESETS, SubtitlePosition } from '../utils/subtitlePosition'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import styles from './SubtitlePositionSettings.module.css'

interface SubtitlePositionSettingsProps {
  position: SubtitlePosition
  onChange: (position: SubtitlePosition) => void
}

/**
 * Picks where subtitles start out on every video, shown on a short and a
 * long sample at once: cues grow from the position both ways, so a spot
 * that suits one can push the other off the safe area. Uses the burn-in's
 * own layout (via SubtitleOverlayPreview), so the frames match the output.
 */
export default function SubtitlePositionSettings({ position, onChange }: SubtitlePositionSettingsProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.frames}>
        {SUBTITLE_SAMPLES.map(sample => (
          <figure key={sample.label} className={styles.figure}>
            <div className={styles.frame}>
              <SubtitleOverlayPreview cues={[sample.cue]} position={position} currentTime={0} />
            </div>
            <figcaption className={styles.caption}>{sample.label}</figcaption>
          </figure>
        ))}
      </div>

      <div className={styles.presets}>
        {SUBTITLE_POSITION_PRESETS.map(p => (
          <button
            key={p.label}
            type="button"
            className={`${styles.presetBtn} ${position === p.value ? styles.presetBtnActive : ''}`}
            aria-pressed={position === p.value}
            onClick={() => onChange(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.header}>
        <span className={styles.label}>字幕の上下位置</span>
        <span className={styles.value}>{Math.round(position)}%</span>
      </div>
      <input
        aria-label="字幕の上下位置"
        className={styles.slider}
        type="range"
        min={0}
        max={100}
        step={1}
        value={position}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}
```

`src/components/SubtitlePositionSettings.module.css`:

```css
.wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 0;
}

.frames {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.figure {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.frame {
  position: relative;
  aspect-ratio: 9 / 16;
  /* SubtitleOverlayPreview sizes itself in cqw of this box (= the video's width). */
  container-type: inline-size;
  overflow: hidden;
  border-radius: 8px;
  background: linear-gradient(180deg, #3a3f4b 0%, #1c1f26 100%);
}

.caption {
  font-size: 0.8rem;
  color: var(--text-muted);
  text-align: center;
}

.presets {
  display: flex;
  gap: 8px;
}

.presetBtn {
  flex: 1;
  background: var(--surface2);
  color: var(--text);
  padding: 8px 0;
  border-radius: 8px;
  font-size: 0.85rem;
}

.presetBtnActive {
  outline: 2px solid var(--accent);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.label {
  font-size: 1rem;
  color: var(--text);
}

.value {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.slider {
  width: 100%;
}
```

- [ ] **Step 6: Mount both in SettingsPage**

In `src/pages/SettingsPage.tsx`, add imports:

```tsx
import BgmSettings from '../components/BgmSettings'
import SubtitlePositionSettings from '../components/SubtitlePositionSettings'
```

and, between the 音声 section's closing `</div>` and the 自動トリミング section, insert:

```tsx
      <div className={styles.section}>
        <div className={styles.sectionTitle}>BGM</div>
        <BgmSettings trackId={settings.defaultBgmId} volume={settings.bgmVolume} onChange={updateSettings} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>字幕の位置</div>
        <div className={styles.rowSub}>短い字幕と長い字幕のどちらも見やすい位置に合わせてください（動画ごとに調整も可）</div>
        <SubtitlePositionSettings
          position={settings.subtitlePosition}
          onChange={subtitlePosition => updateSettings({ subtitlePosition })}
        />
      </div>
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run src/data/subtitleSamples.test.ts src/pages/SettingsPage.test.tsx src/components/SubtitleWorkflow.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/data/subtitleSamples.ts src/data/subtitleSamples.test.ts src/components/BgmSettings.tsx src/components/BgmSettings.module.css src/components/SubtitlePositionSettings.tsx src/components/SubtitlePositionSettings.module.css src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat: set the usual BGM and the subtitle position in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Wire FinalizePage

**Files:**
- Modify: `src/pages/FinalizePage.tsx`
- Test: `src/pages/FinalizePage.test.tsx`

**Interfaces:**
- Consumes: `defaultBgmTrack`, settings keys (Task 1); `PreparedAudio`, `mixForExport` (Task 4); `fetchTrack` (Task 4); MusicMixer props (Task 5).

- [ ] **Step 1: Keep the existing tests on today's flow, and add the new ones**

In `src/pages/FinalizePage.test.tsx`:

1. Extend the `normalizeLoudness` mock:
   ```ts
   vi.mock('../utils/normalizeLoudness', () => ({
     normalizeLoudness: vi.fn(),
     markLoudnessNormalized: vi.fn(),
   }))
   ```
2. Add a mock and imports:
   ```ts
   import { normalizeLoudness, markLoudnessNormalized } from '../utils/normalizeLoudness'
   import { prepareFinalAudio, joinVideoAndAudio } from '../utils/webcodecs/finalAudio'

   vi.mock('../utils/webcodecs/finalAudio', () => ({
     prepareFinalAudio: vi.fn(),
     joinVideoAndAudio: vi.fn(),
   }))
   ```
   (replace the existing `import { normalizeLoudness } ...` line.)
3. In the top-level `beforeEach`, right after `localStorage.clear()`:
   ```ts
   // The tests below predate the usual BGM; they walk the BGM step by hand.
   localStorage.setItem('teleprompter_settings', JSON.stringify({ defaultBgmId: null }))
   ```
   (`seedScript()` runs after this and only touches `teleprompter_scripts`.)
4. Append a new `describe` at the end of the file:

```tsx
describe('FinalizePage with a usual BGM', () => {
  const BURNED = new Blob(['burned'], { type: 'video/mp4' })

  function useSettingsOf(settings: object) {
    localStorage.setItem('teleprompter_settings', JSON.stringify(settings))
  }

  // Trim/combine → subtitle (translated) → 次へ.
  async function walkThroughSubtitles() {
    renderFinalizePage('script-1')
    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
  }

  beforeEach(() => {
    vi.mocked(burnModule.burnSubtitles).mockResolvedValue(BURNED)
  })

  it('adds the usual BGM after the burn and goes straight to export', async () => {
    useSettingsOf({ defaultBgmId: 'lofi-tokyo', bgmVolume: 0.45 })
    await walkThroughSubtitles()

    expect(await screen.findByText('保存する')).toBeInTheDocument()
    expect(mixModule.mixMusic).toHaveBeenCalledTimes(1)
    const [video, , volume] = vi.mocked(mixModule.mixMusic).mock.calls[0]
    expect(video).toBe(BURNED)
    expect(volume).toBe(0.45)
    expect(screen.getByText('BGM').closest('button')).not.toBeDisabled()
  })

  it('opens the BGM step on the usual BGM when going back to it, without mixing again', async () => {
    useSettingsOf({ defaultBgmId: 'lofi-tokyo' })
    await walkThroughSubtitles()
    await screen.findByText('保存する')

    fireEvent.click(screen.getByText('BGM').closest('button')!)
    expect(await screen.findByText('BGMなしで進む')).toBeInTheDocument()
    expect(screen.getByText('Tokyo Lofi').closest('div')?.className).toMatch(/trackRowSelected/)
    expect(mixModule.mixMusic).toHaveBeenCalledTimes(1)
  })

  it('stops on the BGM step as before when the usual BGM is なし', async () => {
    useSettingsOf({ defaultBgmId: null })
    await walkThroughSubtitles()
    expect(await screen.findByText('BGMなしで進む')).toBeInTheDocument()
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })

  it('opens the subtitle step at the usual position, and burns with it', async () => {
    useSettingsOf({ defaultBgmId: null, subtitlePosition: 64 })
    await walkThroughSubtitles()
    await waitFor(() => expect(burnModule.burnSubtitles).toHaveBeenCalled())
    expect(vi.mocked(burnModule.burnSubtitles).mock.calls[0][2]).toBe(64)
  })

  it('joins the burned video with audio prepared during the subtitle step', async () => {
    useSettingsOf({ defaultBgmId: 'lofi-tokyo', bgmVolume: 0.3, normalizeAudio: true })
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(burnModule.burnShotSubtitles).mockResolvedValue(new Blob(['burned-shot'], { type: 'video/mp4' }))
    const prepared = new Blob(['prepared'], { type: 'audio/mp4' })
    const joined = new Blob(['joined'], { type: 'video/mp4' })
    vi.mocked(prepareFinalAudio).mockResolvedValue(prepared)
    vi.mocked(joinVideoAndAudio).mockResolvedValue(joined)
    vi.mocked(normalizeLoudness).mockImplementation(async blob => blob)

    await walkThroughSubtitles()
    expect(await screen.findByText('保存する')).toBeInTheDocument()

    const combined = await vi.mocked(concatVideos).mock.results[0].value
    const burned = await vi.mocked(concatClipsWebCodecs).mock.results[0].value
    expect(prepareFinalAudio).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prepareFinalAudio).mock.calls[0][0]).toBe(combined)
    expect(vi.mocked(prepareFinalAudio).mock.calls[0].slice(2)).toEqual([0.3, true])
    expect(joinVideoAndAudio).toHaveBeenCalledWith(burned, prepared)
    expect(markLoudnessNormalized).toHaveBeenCalledWith(joined)
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pages/FinalizePage.test.tsx`
Expected: the five new tests FAIL; the existing ones PASS.

- [ ] **Step 3: Implement**

In `src/pages/FinalizePage.tsx`:

1. Imports — change `import { useSettings } from '../hooks/useSettings'` to `import { defaultBgmTrack, useSettings } from '../hooks/useSettings'` and add:
   ```ts
   import { PreparedAudio, mixForExport } from '../utils/preparedAudio'
   import { fetchTrack } from '../utils/fetchTrack'
   ```
2. After `const { normalizeAudio } = settings`:
   ```ts
     const defaultTrack = defaultBgmTrack(settings)
     const { bgmVolume } = settings
     // A re-combine (or a fresh visit) starts the subtitles at the usual spot.
     const initialSubtitleState = (): SubtitleState => ({ ...INITIAL_SUBTITLE_STATE, position: settings.subtitlePosition })
   ```
3. Replace `useState<SubtitleState>(INITIAL_SUBTITLE_STATE)` with `useState<SubtitleState>(initialSubtitleState)`.
4. Below the `completedSteps` state, add:
   ```ts
     // The BGM step was just entered from a finished burn with a usual BGM
     // set: it mixes that straight away. Coming back to it later never does.
     const [bgmAutoPending, setBgmAutoPending] = useState(false)
     const [preparedAudio] = useState(() => new PreparedAudio())
   ```
5. In `goToStep`, before `setStep(target)`, add `setBgmAutoPending(false)`.
6. In `handleCombine`, replace `setSubtitleState(INITIAL_SUBTITLE_STATE)` with:
   ```ts
       setSubtitleState(initialSubtitleState())
       preparedAudio.clear()
   ```
7. After the background subtitle-burn effect (the one ending `}, [step, subtitleStage, subtitleCues, subtitlePosition, combinedClips])`), add:
   ```ts
     // Build the finished audio (usual BGM + loudness) while the subtitles
     // are worked on: they only change the picture, so after the burn the
     // BGM step just joins this audio to the burned video. Hardware path
     // only; the ffmpeg.wasm fallback mixes after the burn as before.
     useEffect(() => {
       if (step !== 'subtitle' || !combinedBlob || !defaultTrack) return
       let cancelled = false
       void canUseWebCodecs().then(ok => {
         if (cancelled || !ok) return
         preparedAudio.prepare(
           combinedBlob,
           { trackId: defaultTrack.id, volume: bgmVolume, normalize: normalizeAudio },
           () => fetchTrack(defaultTrack),
         )
       })
       return () => {
         cancelled = true
       }
     }, [step, combinedBlob, defaultTrack, bgmVolume, normalizeAudio, preparedAudio])
   ```
8. In the SubtitleWorkflow `onBurned`:
   ```tsx
                   onBurned={burned => {
                     setBurnedBlob(burned)
                     setBgmAutoPending(defaultTrack !== null)
                     markStepDone('subtitle', 'bgm')
                   }}
   ```
9. Replace the `<MusicMixer ... />` element with:
   ```tsx
                 <MusicMixer
                   // Deliberately NOT `finalBlob`: MusicMixer must always mix onto
                   // the video from before any BGM was ever added, otherwise a
                   // track/volume change re-mixes onto its own previous mixed
                   // output and BGM layers stack indefinitely.
                   videoBlob={(burnedBlob ?? combinedBlob) as Blob}
                   initialTrackId={defaultTrack?.id ?? null}
                   initialVolume={bgmVolume}
                   autoMix={bgmAutoPending}
                   mix={(track, trackBlob, volume) =>
                     mixForExport(preparedAudio, combinedBlob as Blob, (burnedBlob ?? combinedBlob) as Blob, trackBlob, {
                       trackId: track.id,
                       volume,
                       normalize: normalizeAudio,
                     })
                   }
                   onMixed={setMixedBlob}
                   onNext={() => {
                     setBgmAutoPending(false)
                     markStepDone('bgm', 'export')
                   }}
                 />
   ```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/pages/FinalizePage.test.tsx`
Expected: PASS (old and new).

- [ ] **Step 5: Commit**

```bash
git add src/pages/FinalizePage.tsx src/pages/FinalizePage.test.tsx
git commit -m "feat: add the usual BGM without stopping, from audio prepared during subtitles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verify

**Files:** none changed unless a check fails (then fix in the relevant task's files and commit `fix: ...`).

- [ ] **Step 1: Full suite, types, lint**

Run: `npx vitest run && npx tsc -b && npx eslint .`
Expected: all tests pass, no type errors, no lint errors.

- [ ] **Step 2: Start the preview from this worktree**

`preview_start` reads the main checkout's `.claude/launch.json`. Add a temporary entry there (remove it in Step 6):

```json
{ "name": "default-bgm", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "/Users/yujioyama/Site/teleprompter/.claude/worktrees/default-bgm", "run", "dev", "--", "--port", "5191"], "port": 5191 }
```

Then `preview_start { name: "default-bgm" }`.

- [ ] **Step 3: Settings page at phone width**

`resize_window { preset: "mobile" }`, navigate to `/settings`. Check with `read_page` that いつものBGM shows Tokyo Lofi, 音量 30%, and both sample frames render. Count the real lines with `javascript_tool`:

```js
[...document.querySelectorAll('[data-testid="subtitle-overlay-box"]')].map(b => [...b.querySelectorAll('p')].map(p => p.children.length))
```

Expected: `[[1,1],[3,3]]`. Move the slider to 90 and screenshot: the long sample's box must stay inside its frame at the positions the user is likely to choose; record what you see. Reset with `resize_window { preset: "desktop" }`.

- [ ] **Step 4: Prepared audio equals the old two passes (real WebCodecs, Chrome)**

In the preview tab, run with `javascript_tool`:

```js
const mb = await import('/node_modules/.vite/deps/mediabunny.js').catch(() => import('mediabunny'))
const { prepareFinalAudio, joinVideoAndAudio } = await import('/src/utils/webcodecs/finalAudio.ts')
const { mixMusicWebCodecs } = await import('/src/utils/webcodecs/mixMusicWebCodecs.ts')
const { normalizeLoudnessWebCodecs } = await import('/src/utils/webcodecs/normalizeLoudnessWebCodecs.ts')
const { decodeAudioTrack } = await import('/src/utils/webcodecs/audioTrack.ts')

// A 4 s test video: grey frames + a 440 Hz tone, 48 kHz stereo.
const canvas = new OffscreenCanvas(360, 640); const g = canvas.getContext('2d')
const out = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() })
const vsrc = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: 1e6 }); out.addVideoTrack(vsrc, { frameRate: 30 })
const asrc = new mb.AudioBufferSource({ codec: 'aac', bitrate: 128e3 }); out.addAudioTrack(asrc)
await out.start()
for (let i = 0; i < 120; i++) { g.fillStyle = `rgb(${i},${i},${i})`; g.fillRect(0, 0, 360, 640); await vsrc.add(i / 30, 1 / 30) }
const tone = new AudioBuffer({ numberOfChannels: 2, length: 48000 * 4, sampleRate: 48000 })
for (let c = 0; c < 2; c++) { const d = tone.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = 0.2 * Math.sin(2 * Math.PI * 440 * i / 48000) }
await asrc.add(tone); await out.finalize()
const video = new Blob([out.target.buffer], { type: 'video/mp4' })
const track = await (await fetch('/music/lofi-05-tokyo.mp3')).blob()

const t0 = performance.now()
const oldWay = await normalizeLoudnessWebCodecs(await mixMusicWebCodecs(video, track, 0.3))
const t1 = performance.now()
const audio = await prepareFinalAudio(video, track, 0.3, true)
const t2 = performance.now()
const newWay = await joinVideoAndAudio(video, audio)
const t3 = performance.now()

async function pcm(blob) {
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS })
  const buf = await decodeAudioTrack(await input.getPrimaryAudioTrack()); return buf.getChannelData(0)
}
const a = await pcm(oldWay), b = await pcm(newWay)
let maxDiff = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]))
const inNew = new mb.Input({ source: new mb.BlobSource(newWay), formats: mb.ALL_FORMATS })
;({ lengths: [a.length, b.length], maxDiff, oldMs: Math.round(t1 - t0), prepareMs: Math.round(t2 - t1), joinMs: Math.round(t3 - t2),
   hasVideo: !!(await inNew.getPrimaryVideoTrack()), duration: await inNew.computeDuration() })
```

Expected: `hasVideo: true`, lengths within ~1 AAC frame (1024 samples), `maxDiff` small (two lossy AAC encodes of the same signal — well under 0.05; a large value or a ~1000-sample offset means the priming delay was lost in the copy), and `joinMs` far below `oldMs`. If the dynamic import of `mediabunny` fails, get the deps URL from `read_network_requests` (`urlPattern: "mediabunny"`). Record the numbers for the PR.

- [ ] **Step 5: Flow check in the preview**

Without recorded shots the finalize flow can't run in the preview; rely on Task 8's tests for the flow and note that the real flow is checked on the device (Step 7).

- [ ] **Step 6: Clean up**

`preview_stop` the server and remove the temporary `default-bgm` entry from the main checkout's `.claude/launch.json`.

- [ ] **Step 7: Hand the device check to the user**

The simulator doesn't reproduce iPhone media behaviour, so ask the user to check on their iPhone (Vercel preview of the PR):
1. Settings: いつものBGM = Tokyo Lofi; set the subtitle position against both samples.
2. Finalize a real video: the subtitle step opens with cues generated and at the set position; after 次へ, the page goes to 書き出し without stopping at BGM.
3. Time 焼き込み完了 → 書き出し画面 (before: on `main`; after: this branch).
4. Play the export: voice in sync with lips, BGM fades in at the start and out at the end, volume as before.
