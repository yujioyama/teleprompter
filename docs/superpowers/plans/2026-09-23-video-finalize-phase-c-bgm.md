# Video Finalize — Phase C: BGM Selection, Mixing, Final Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user can pick a background-music track (grouped by genre, with a volume slider), mix it under the narration audio of whichever video is currently "furthest along" (subtitled, if Phase B's burn-in was used; otherwise the plain combined video from Phase A), and save the final result — completing the 3-phase Finalize pipeline.

**Architecture:** A new `MusicMixer` component, mounted in `FinalizePage` after `SubtitleWorkflow`, fed the most-finished video blob available. `SubtitleWorkflow` gains a new optional callback prop (`onBurned`) so `FinalizePage` can learn about a successful subtitle burn-in without owning that state itself. BGM mixing probes the video's duration (reusing the log-listener pattern already used in `remuxMp4.ts`), loops/trims/fades the chosen track to match via FFmpeg's `aloop`/`afade` filters, and mixes it with the existing audio via `amix` — video stream is copied, not re-encoded, matching the existing normalization pass's cheap-video/audio-only-work pattern.

**Tech Stack:** React 18 + TypeScript, `@ffmpeg/ffmpeg` (already used throughout this feature).

## Global Constraints

- No new backend/server — everything stays client-side.
- Follow existing code style: no semicolons, single quotes, 2-space indent, CSS Modules.
- **Type-check with `npx tsc -b`, never `npx tsc --noEmit -p .`.** This repo's `tsconfig.json` is a solution-style config (`files: []`, only `references`); non-build mode silently checks nothing. This has already caused one real production deploy failure on this project — every task must verify with `tsc -b`.
- FFmpeg-call-heavy code is verified manually via the dev server, not unit-tested; extract and unit-test the pure, non-FFmpeg logic around it, matching every prior phase's convention.
- **`MUSIC_TRACKS` (Task 1) ships with an empty array.** Sourcing real royalty-free audio files requires explicit user permission per download (a policy constraint, not a technical one) and is handled as a separate follow-up step outside this plan, after this code lands. Every task's manual verification should use a synthesized test tone (`ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -c:a libmp3lame test-track.mp3`, or similar), generated fresh for that verification and not committed — never a downloaded file.
- Because `MUSIC_TRACKS` is empty until that follow-up, the BGM section should not render at all when there are zero tracks (checked in Task 5) — this is expected, correct behavior for now, not a bug to work around.
- Reuse `SubtitleCue`/`SubtitlePosition` etc. from their existing modules where relevant — this phase introduces `MusicTrack` as its one new domain type.

---

### Task 1: `musicTracks.ts` — track metadata type and (empty) catalog

**Files:**
- Create: `src/data/musicTracks.ts`

**Interfaces:**
- Produces: `MusicGenre = 'lofi' | 'pop' | 'cinematic' | 'corporate'`, `MusicTrack { id: string; title: string; genre: MusicGenre; credit: string; file: string }`, `GENRE_LABELS: Record<MusicGenre, string>` (Japanese display labels), `MUSIC_TRACKS: MusicTrack[]` (empty for now). Used by Task 3 (`MusicPicker`) and Task 5 (`FinalizePage` wiring, to decide whether to render the BGM section at all).

No test file: this is a plain data/type module with no logic — nothing to unit-test (same reasoning already applied to `extractAudioForTranscription.ts` in Phase B for its fixed-arg case, here applied to a fixed-shape data module).

- [ ] **Step 1: Write the implementation**

Create `src/data/musicTracks.ts`:

```ts
export type MusicGenre = 'lofi' | 'pop' | 'cinematic' | 'corporate'

export interface MusicTrack {
  id: string
  title: string
  genre: MusicGenre
  credit: string
  /** Path under public/, e.g. 'music/lofi-01.mp3' */
  file: string
}

export const GENRE_LABELS: Record<MusicGenre, string> = {
  lofi: 'Lo-fi / チル',
  pop: 'ポップ / アップビート',
  cinematic: '感動 / シネマチック',
  corporate: 'コーポレート / モチベーション',
}

// Populated in a follow-up once royalty-free tracks have been sourced and
// added under public/music/ — see docs/superpowers/specs/2026-09-23-video-finalize-design.md.
// The BGM section in FinalizePage does not render while this is empty.
export const MUSIC_TRACKS: MusicTrack[] = []
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no output (clean)

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: PASS (all existing tests, no new ones from this task)

- [ ] **Step 4: Commit**

```bash
git add src/data/musicTracks.ts
git commit -m "feat: add MusicTrack type and empty track catalog"
```

---

### Task 2: `mixMusic` — loop/fade/mix a track under the video's audio

**Files:**
- Create: `src/utils/mixMusic.ts`
- Test: `src/utils/mixMusic.test.ts`

**Interfaces:**
- Produces: `buildMixFilterComplex(durationSeconds: number, volume: number): string` (pure, tested), `mixMusic(videoBlob: Blob, trackBlob: Blob, volume: number): Promise<Blob>` (FFmpeg, manually verified). Used by Task 4 (`MusicMixer`).

- [ ] **Step 1: Write the failing test for the pure filter-string builder**

Create `src/utils/mixMusic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildMixFilterComplex } from './mixMusic'

describe('buildMixFilterComplex', () => {
  it('loops the track, fades in/out around the exact video duration, applies volume, then mixes with the original audio', () => {
    const result = buildMixFilterComplex(30, 0.5)
    expect(result).toBe(
      "[1:a]aloop=loop=-1:size=2e9,atrim=0:30.000,afade=t=in:d=1,afade=t=out:st=29.000:d=1,volume=0.5[bgm];" +
      "[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]"
    )
  })

  it('formats a fractional duration to 3 decimal places', () => {
    const result = buildMixFilterComplex(12.3456, 0.8)
    expect(result).toContain('atrim=0:12.346')
    expect(result).toContain('afade=t=out:st=11.346:d=1')
  })

  it('clamps the fade-out start at 0 for a very short video (under 1s)', () => {
    const result = buildMixFilterComplex(0.5, 1)
    expect(result).toContain('afade=t=out:st=0.000:d=1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- mixMusic`
Expected: FAIL — `Cannot find module './mixMusic'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/mixMusic.ts`:

```ts
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null
let loaded = false

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) ffmpeg = new FFmpeg()
  if (!loaded) {
    const origin = window.location.origin
    await ffmpeg.load({
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
    })
    loaded = true
  }
  return ffmpeg
}

/**
 * Build the filter_complex that loops/trims the BGM track (input 1) to the
 * video's exact duration, fades it in/out at the edges, applies the user's
 * chosen volume, then mixes it with the original audio (input 0). Video is
 * left untouched by the caller (stream-copied, not part of this filter).
 */
export function buildMixFilterComplex(durationSeconds: number, volume: number): string {
  const duration = durationSeconds.toFixed(3)
  const fadeOutStart = Math.max(0, durationSeconds - 1).toFixed(3)
  return (
    `[1:a]aloop=loop=-1:size=2e9,atrim=0:${duration},afade=t=in:d=1,afade=t=out:st=${fadeOutStart}:d=1,volume=${volume}[bgm];` +
    `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]`
  )
}

/** Probe a written file's container duration in seconds, via FFmpeg's own log output. */
async function probeDuration(ff: FFmpeg, filename: string): Promise<number> {
  let duration: number | null = null
  const handler = ({ message }: { message: string }) => {
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message)
    if (m && duration === null) {
      duration = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])
    }
  }
  ff.on('log', handler)
  try {
    await ff.exec(['-i', filename, '-f', 'null', '-'])
  } catch {
    // ffmpeg exits non-zero for this probe-only invocation; the log listener
    // above already captured Duration before that, so this is expected.
  }
  ff.off('log', handler)
  if (duration === null) throw new Error(`Could not determine duration of ${filename}`)
  return duration
}

/**
 * Mix a BGM track under a video's existing audio, looped/faded to match the
 * video's exact duration at the given volume (0-1). Video stream is copied;
 * only audio is re-encoded.
 */
export async function mixMusic(videoBlob: Blob, trackBlob: Blob, volume: number): Promise<Blob> {
  const ff = await getFFmpeg()
  await ff.writeFile('in.mp4', await fetchFile(videoBlob))
  await ff.writeFile('track.mp3', await fetchFile(trackBlob))

  const duration = await probeDuration(ff, 'in.mp4')
  const filterComplex = buildMixFilterComplex(duration, volume)

  await ff.exec([
    '-i', 'in.mp4',
    '-i', 'track.mp3',
    '-filter_complex', filterComplex,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    'out.mp4',
  ])

  const data = await ff.readFile('out.mp4')
  ff.deleteFile('in.mp4')
  ff.deleteFile('track.mp3')
  ff.deleteFile('out.mp4')
  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- mixMusic`
Expected: PASS (3 tests)

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: no output (clean)

- [ ] **Step 6: Manually verify the mix actually works**

Generate two synthetic test fixtures for this check only (do not commit them):

```bash
ffmpeg -f lavfi -i "testsrc=size=320x240:duration=6" -f lavfi -i "sine=frequency=220:duration=6" -shortest -c:v libx264 -c:a aac test-video.mp4
ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -c:a libmp3lame test-track.mp3
```

Call `mixMusic(videoBlob, trackBlob, 0.5)` (e.g. from the dev console via a temporary button, or a throwaway script) and confirm: the output plays for the full 6 seconds (the video's own duration, not the 3-second track's), the 220Hz tone (original audio) and the looped 440Hz tone (BGM) are both audibly present and mixed, the BGM fades in at the start and out at the end rather than cutting abruptly, and the BGM has looped at least once by 6 seconds (since the track is only 3s). Remove any temporary verification wiring before committing.

- [ ] **Step 7: Commit**

```bash
git add src/utils/mixMusic.ts src/utils/mixMusic.test.ts
git commit -m "feat: add mixMusic with a pure, tested filter-complex builder"
```

---

### Task 3: `MusicPicker` — genre-grouped track picker with volume slider

**Files:**
- Create: `src/components/MusicPicker.tsx`, `src/components/MusicPicker.module.css`

**Interfaces:**
- Consumes: `MusicTrack`, `GENRE_LABELS` from Task 1.
- Produces: `<MusicPicker tracks={tracks} selectedId={id} onSelect={fn} volume={v} onVolumeChange={fn} />`. Used by Task 4 (`MusicMixer`).

No automated test — small presentational component, matching this feature's established convention for interactive UI (`SubtitleEditor`, `ShotTrimmer` also have none).

- [ ] **Step 1: Write the component**

Create `src/components/MusicPicker.module.css`:

```css
.wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.genreGroup {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.genreLabel {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.trackRow {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface2);
  border-radius: 8px;
  padding: 8px 10px;
}

.trackRowSelected {
  outline: 2px solid var(--accent);
}

.trackTitle {
  flex: 1;
  font-size: 0.85rem;
  color: var(--text);
  text-align: left;
  background: none;
}

.previewBtn {
  background: var(--surface);
  color: var(--text);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
}

.volumeRow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.volumeLabel {
  color: var(--text-muted);
  font-size: 0.8rem;
  white-space: nowrap;
}

.volumeSlider {
  flex: 1;
}
```

Create `src/components/MusicPicker.tsx`:

```tsx
import { useRef, useState } from 'react'
import { MusicTrack, GENRE_LABELS, MusicGenre } from '../data/musicTracks'
import styles from './MusicPicker.module.css'

interface MusicPickerProps {
  tracks: MusicTrack[]
  selectedId: string | null
  onSelect: (id: string) => void
  volume: number
  onVolumeChange: (volume: number) => void
}

const GENRE_ORDER: MusicGenre[] = ['lofi', 'pop', 'cinematic', 'corporate']

export default function MusicPicker({ tracks, selectedId, onSelect, volume, onVolumeChange }: MusicPickerProps) {
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function handlePreview(track: MusicTrack) {
    if (previewingId === track.id) {
      audioRef.current?.pause()
      setPreviewingId(null)
      return
    }
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener('ended', () => setPreviewingId(null))
    }
    audioRef.current.src = `/${track.file}`
    audioRef.current.play()
    setPreviewingId(track.id)
  }

  return (
    <div className={styles.wrapper}>
      {GENRE_ORDER.map(genre => {
        const genreTracks = tracks.filter(t => t.genre === genre)
        if (genreTracks.length === 0) return null
        return (
          <div key={genre} className={styles.genreGroup}>
            <p className={styles.genreLabel}>{GENRE_LABELS[genre]}</p>
            {genreTracks.map(track => (
              <div
                key={track.id}
                className={`${styles.trackRow} ${selectedId === track.id ? styles.trackRowSelected : ''}`}
              >
                <button className={styles.trackTitle} onClick={() => onSelect(track.id)}>
                  {track.title}
                </button>
                <button className={styles.previewBtn} onClick={() => handlePreview(track)}>
                  {previewingId === track.id ? '■ 停止' : '▶ 試聴'}
                </button>
              </div>
            ))}
          </div>
        )
      })}

      <div className={styles.volumeRow}>
        <span className={styles.volumeLabel}>音量 {Math.round(volume * 100)}%</span>
        <input
          className={styles.volumeSlider}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Manually verify in the dev server**

Temporarily render `<MusicPicker tracks={sampleTracks} selectedId={null} onSelect={console.log} volume={0.5} onVolumeChange={console.log} />` in `FinalizePage.tsx` with a few hand-written `MusicTrack` objects across at least two genres (pointing at real audio files you place under `public/music/` for this manual check only, or any existing audio asset — do not commit these test files or the temporary wiring). Confirm: tracks group under the right genre headers, clicking a track's title calls `onSelect` with its id, clicking "▶ 試聴" plays it and toggles to "■ 停止", the volume slider updates and calls `onVolumeChange`. Revert the temporary wiring — Task 5 does this for real.

- [ ] **Step 3: Run the full test suite and type-check**

Run: `npm run test` (expect no regressions) and `npx tsc -b` (expect clean)

- [ ] **Step 4: Commit**

```bash
git add src/components/MusicPicker.tsx src/components/MusicPicker.module.css
git commit -m "feat: add MusicPicker genre-grouped track picker with volume slider"
```

---

### Task 4: `MusicMixer` — wire picker → mix → save

**Files:**
- Create: `src/components/MusicMixer.tsx`, `src/components/MusicMixer.module.css`

**Interfaces:**
- Consumes: `MusicTrack`, `MUSIC_TRACKS` (Task 1), `MusicPicker` (Task 3), `mixMusic` (Task 2), `shareOrDownload` (existing, from Phase A).
- Produces: `<MusicMixer videoBlob={blob} filenameBase={string} />`. Used by Task 5 (`FinalizePage` wiring).

- [ ] **Step 1: Write the component**

Create `src/components/MusicMixer.module.css`:

```css
.wrapper {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sectionTitle {
  font-weight: 700;
  font-size: 0.95rem;
}

.mixBtn {
  background: var(--accent);
  color: #fff;
  padding: 14px 32px;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 700;
}

.mixBtn:disabled {
  opacity: 0.5;
}

.error {
  color: var(--danger);
  font-size: 0.85rem;
}

.preview {
  width: 100%;
  border-radius: 8px;
  background: #000;
}
```

Create `src/components/MusicMixer.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { MUSIC_TRACKS } from '../data/musicTracks'
import { mixMusic } from '../utils/mixMusic'
import { shareOrDownload } from '../utils/shareOrDownload'
import MusicPicker from './MusicPicker'
import styles from './MusicMixer.module.css'

interface MusicMixerProps {
  videoBlob: Blob
  filenameBase: string
}

type Stage = 'idle' | 'mixing' | 'done' | 'error'

export default function MusicMixer({ videoBlob, filenameBase }: MusicMixerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [volume, setVolume] = useState(0.3)
  const [stage, setStage] = useState<Stage>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [mixedUrl, setMixedUrl] = useState<string | null>(null)
  const [mixedBlob, setMixedBlob] = useState<Blob | null>(null)
  const mixedUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (mixedUrlRef.current) {
        URL.revokeObjectURL(mixedUrlRef.current)
      }
    }
  }, [])

  if (MUSIC_TRACKS.length === 0) return null

  async function handleMix() {
    const track = MUSIC_TRACKS.find(t => t.id === selectedId)
    if (!track) return

    setStage('mixing')
    setErrorMessage(null)
    try {
      const trackBlob = await fetch(`/${track.file}`).then(r => r.blob())
      const mixed = await mixMusic(videoBlob, trackBlob, volume)
      if (mixedUrlRef.current) {
        URL.revokeObjectURL(mixedUrlRef.current)
      }
      const url = URL.createObjectURL(mixed)
      mixedUrlRef.current = url
      setMixedBlob(mixed)
      setMixedUrl(url)
      setStage('done')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  async function handleSave() {
    if (!mixedBlob) return
    await shareOrDownload(mixedBlob, `${filenameBase}-final`)
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.section}>
        <p className={styles.sectionTitle}>BGMを追加</p>
        <MusicPicker
          tracks={MUSIC_TRACKS}
          selectedId={selectedId}
          onSelect={setSelectedId}
          volume={volume}
          onVolumeChange={setVolume}
        />
        <button
          className={styles.mixBtn}
          onClick={handleMix}
          disabled={!selectedId || stage === 'mixing'}
        >
          {stage === 'mixing' ? '合成中...' : 'BGMを合成する'}
        </button>
        {stage === 'error' && errorMessage && <p className={styles.error}>エラーが発生しました: {errorMessage}</p>}
      </div>

      {stage === 'done' && mixedUrl && (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>完成した動画</p>
          <video className={styles.preview} src={mixedUrl} controls playsInline />
          <button className={styles.mixBtn} onClick={handleSave}>
            保存する
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Manually verify end to end**

Using the same synthetic test video from Task 2's manual verification (or a freshly generated one) and 1-2 hand-written `MusicTrack` entries pointing at real short audio files placed under `public/music/` for this check only: temporarily set `MUSIC_TRACKS` (or pass a local override) to include them, render `<MusicMixer videoBlob={testVideoBlob} filenameBase="test" />`, select a track, adjust volume, click "BGMを合成する", confirm the result preview plays with mixed audio, click "保存する" and confirm the share/download triggers with filename `test-final.mp4`. Revert any temporary `MUSIC_TRACKS`/test-file changes — Task 1's file stays an empty array in the committed diff.

- [ ] **Step 3: Run the full test suite and type-check**

Run: `npm run test` (expect no regressions) and `npx tsc -b` (expect clean)

- [ ] **Step 4: Commit**

```bash
git add src/components/MusicMixer.tsx src/components/MusicMixer.module.css
git commit -m "feat: add MusicMixer wiring picker, mix, and save"
```

---

### Task 5: Wire `MusicMixer` into `FinalizePage`, fed by the best available video

**Files:**
- Modify: `src/components/SubtitleWorkflow.tsx` (add an optional `onBurned` callback prop)
- Modify: `src/pages/FinalizePage.tsx`

**Interfaces:**
- Consumes: `MusicMixer` from Task 4.
- Produces: `SubtitleWorkflowProps` gains `onBurned?: (blob: Blob) => void`.

- [ ] **Step 1: Add the `onBurned` callback to `SubtitleWorkflow`**

Read the current `src/components/SubtitleWorkflow.tsx` first. Add `onBurned?: (blob: Blob) => void` to `SubtitleWorkflowProps`, destructure it in the component's props, and call it with the burned blob at the point `handleBurnIn` succeeds — right where it already calls `setBurnedBlob(burned)`:

```tsx
      setBurnedBlob(burned)
      setBurnedUrl(url)
      setStage('done')
      onBurned?.(burned)
```

(Exact insertion point: immediately after the existing `setBurnedUrl(url)` / before or after `setStage('done')` — either ordering is fine since these are independent state updates; add the `onBurned?.(burned)` call alongside them without altering anything else in that function.)

- [ ] **Step 2: Wire `MusicMixer` into `FinalizePage`**

Read the current `src/pages/FinalizePage.tsx` first. Add:

1. Import: `import MusicMixer from '../components/MusicMixer'`
2. New state: `const [subtitledBlob, setSubtitledBlob] = useState<Blob | null>(null)`
3. Pass `onBurned={setSubtitledBlob}` to the existing `<SubtitleWorkflow>` element
4. Compute `const finalBlob = subtitledBlob ?? combinedBlob` right before the `combineState === 'done'` render block (or wherever `combinedBlob` is already in scope for that block)
5. Render `MusicMixer` after `SubtitleWorkflow` in the same JSX block, guarded on `finalBlob` being non-null (it will be, inside the `combineState === 'done' && combinedBlob` branch, but TypeScript needs the check):

```tsx
              {combinedBlob && (
                <SubtitleWorkflow
                  combinedBlob={combinedBlob}
                  filenameBase={`${script.title}-combined`}
                  onBurned={setSubtitledBlob}
                />
              )}
              {finalBlob && (
                <MusicMixer videoBlob={finalBlob} filenameBase={`${script.title}-final`} />
              )}
```

(Adjust to fit the file's actual current structure — the brief's snippet assumes `combinedBlob` is already the guard for this whole region, per Task 9 of Phase A's original wiring; verify against the real current file rather than assuming line numbers.)

- [ ] **Step 3: Manually verify in the dev server**

1. Complete a combine (Phase A flow) and confirm `MusicMixer` does NOT render (since `MUSIC_TRACKS` is still empty) — this is the expected, correct state until tracks are added in a follow-up.
2. Temporarily add one or two entries to `MUSIC_TRACKS` pointing at real short audio files under `public/music/` (not committed) to confirm the section DOES appear once tracks exist, and that it appears using `combinedBlob` when no subtitles have been burned yet.
3. Complete the subtitle burn-in flow (Phase B) and confirm `onBurned` fires — verify (e.g. via a temporary console.log, or by observing that `MusicMixer`, once tracks exist, now mixes against the *subtitled* video rather than the plain combined one — you can confirm this by checking the mixed output visually shows the burned-in captions).
4. Revert the temporary `MUSIC_TRACKS` entries and any test files before committing — `src/data/musicTracks.ts` must stay an empty array in the committed diff.

- [ ] **Step 4: Run the full test suite and type-check**

Run: `npm run test` (expect no regressions) and `npx tsc -b` (expect clean)

- [ ] **Step 5: Commit**

```bash
git add src/components/SubtitleWorkflow.tsx src/pages/FinalizePage.tsx
git commit -m "feat: wire MusicMixer into FinalizePage, fed by the best available video"
```

---

## Self-Review Notes

- **Spec coverage:** Covers the design doc's BGM selection, volume mixing, and final export. The 20-track catalog itself is explicitly out of scope for this plan (ships empty; see Global Constraints) — a deliberate, disclosed scope boundary agreed with the user, not an oversight.
- **Type consistency:** `MusicTrack`/`MusicGenre`/`GENRE_LABELS`/`MUSIC_TRACKS` defined once (Task 1), consumed unchanged by Tasks 3-5. `SubtitleWorkflow`'s new `onBurned` prop is optional (`?.()`), so it's a strictly additive, non-breaking change to an already-shipped component.
- **No placeholders:** every step has complete, runnable code. The empty `MUSIC_TRACKS` array is a deliberate, explained design choice (see Global Constraints), not a `TODO`.
- **Follow-up (not part of this plan):** after this code merges, real royalty-free tracks need to be sourced and added — this requires the user's explicit permission for each download and is handled directly in conversation, not delegated to an implementation task.
