# Sticker Fairies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three things to the video:

- small emoji "fairies" that fly through chosen middle shots
- a finale in the last shot, where line 1's emoji lands and bursts
- sparkle trails on these and on the first-shot sticker

The preview and both WebCodecs burn paths must draw them identically.

**Architecture:** Three pure modules carry the logic:

- `fairyMotion` holds the paths.
- `sparkles` emits deterministic particles and draws them.
- `fairyPlan` decides which shots get which appearance.

They produce data (`FairyAppearance[]`, `Sparkle[]`). The existing sprite
overlay path consumes it: `renderSubtitleOverlays` → `createOverlayProcess`.
So does `SubtitleOverlayPreview`, which draws on a canvas. Everything is
computed ahead of time, so any frame can be drawn from `t` alone.

**Tech Stack:** React 19 + TypeScript, Vitest + jsdom, Mediabunny/WebCodecs, OffscreenCanvas 2D.

**Spec:** `docs/superpowers/specs/2026-10-16-sticker-fairies-design.md`

**Deviations from the spec:**

- **Script text reaches the burn as a `shotTexts: string[]` parameter.**
  It is passed to `shotBurnRequests` and `burnSubtitlesByShot`, taken from
  `shotCueInputs`. `ShotClip` does not gain `text`. That would touch
  `clipOf`, the saved clips and the restore path for no gain.
- **`SubtitleWorkflow` computes the plan once.** It passes `fairies` to
  `SubtitleOverlayPreview` instead of passing `shots`, because
  `followsFrames` needs the same plan.

## Global Constraints

- **Worktree.** Work in `.claude/worktrees/sticker-fairies`, branch
  `feat/sticker-fairies`. Run `npm ci` there once before Task 1. Never
  switch the main checkout's branch.
- **Type check.** Use `npx tsc -b`. `tsc --noEmit -p .` checks nothing in
  this repo.
- **Tests.** Run `npx vitest run <file>` per task and `npx vitest run` for
  all. Remove any `.claude/worktrees/*` other than this one before a full
  run, or tests run twice.
- **Commit messages.** Keep each task's message exactly as written. Every
  message ends with the line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Frame coordinates.** x and y are fractions of the 1080×1920 frame.
  Use `ASPECT = 1080 / 1920` for y speeds.
- **Spec constants, verbatim:**
  - `END_MARGIN = 0.1`
  - `CAMEO_DELAY = 0.3`
  - `MIN_CAMEO = 0.8`
  - cameo lengths: `glide` 1.2, `peek` 1.6, `loop` 1.4
  - `FINALE_FLY = 0.6`, `FINALE_BURST = 0.3`
  - finale bands: `D ≥ 1.2` normal; `1.0 ≤ D < 1.2` hover 0.2 and fly
    `D − 0.6`; `D < 1.0` none
  - `FAIRY_SCALE = 0.62`
  - `STICKER_EMOJI_PX = 200`, `STICKER_OUTLINE_PX = 13`
- **Sparkle constants, verbatim:**
  - trail 120/s, burst 18, twinkle 7/s
  - life 0.40–0.75 s
  - radius 10–28 px at 1080 width
  - colors `#FFFFFF` (p = 0.55) else `#FAC775`
  - burst speed 0.18–0.40 frame-widths/s
  - trail drift 0.02 frame-heights/s down
  - spawn spread ±0.5 sprite radius (trail), ±0.7 (twinkle)
  - sample step 1/120 s
  - emission stops at `end − 0.1`
  - life clamped to `end − born`; drop particles under 0.1 s
- **ffmpeg path.** No fairies and no sparkles. The sticker is unchanged
  there.
- **Copy.** UI copy is Japanese. Code comments follow the surrounding
  English style.

## Review Focus

1. **A ZWJ or skin-toned emoji on a middle line** (👨‍🍳, 👍🏽) must fly
   as one glyph, not as fragments. Tested in Task 3.
2. **A middle line with two emoji.** The cameo uses the first one, and
   neither is drawn in the subtitle text. Tested in Tasks 3 and 6.
3. **Turning 妖精 OFF after a background pre-burn.** The shot's cache key
   must change, so the next burn drops the fairy. Tested in Task 7.
4. **`shotTexts` shorter than the clips** (e.g. a missing entry). The
   shots without text get no fairy, and nothing throws. Tested in Task 7.
5. **The right-side entries** (mirrored `peek`/`loop`, reversed `glide`)
   must never enter the button column (x > 0.7 and y > 0.5) while the
   fairy is on-frame. Tested in Task 2.

---

### Task 1: Seeded random module and sparkles

**Files:**
- Create: `src/utils/seededRandom.ts`, `src/utils/sparkles.ts`, `src/utils/sparkles.test.ts`
- Modify: `src/utils/stickerMotion.ts`. Delete its private `hash` and
  `random` and import them instead. Export `AREA`, `inButtonColumn`,
  `onFace`, `ASPECT`, `clamp`, `lerp` and `easeInOut`.

**Interfaces:**
- Produces:
  - `hash(text: string): number`
  - `random(seed: number): () => number`. The bodies move unchanged from
    `stickerMotion.ts`.
  - `interface Sparkle { born: number; life: number; x: number; y: number; vx: number; vy: number; radius: number; color: string }`.
    `x`, `y` are fractions of the frame, `vx`, `vy` are fractions per
    second, and `radius` is in px at 1080 width.
  - `emitSparkles(opts: { path: StickerPath; start: number; end: number; seed: number; spread: number; bursts: number[]; moving: (t: number) => boolean }): Sparkle[]`
  - `drawSparkles(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, sparkles: Sparkle[], t: number, width: number, height: number): void`

- [ ] **Step 1: Write the failing tests** in `sparkles.test.ts`

```ts
const still = () => ({ x: 0.5, y: 0.5, rotation: 0, scale: 1 })
const base = { path: still, start: 1, end: 3, seed: 7, spread: 0.1, bursts: [], moving: () => true }

it('is the same for the same seed and differs for another', () => {
  expect(emitSparkles(base)).toEqual(emitSparkles(base))
  expect(emitSparkles({ ...base, seed: 8 })).not.toEqual(emitSparkles(base))
})
it('dies by the end: born + life ≤ end, life ≥ 0.1, none born after end − 0.1', () => {
  for (const s of emitSparkles(base)) {
    expect(s.born + s.life).toBeLessThanOrEqual(3 + 1e-9)
    expect(s.life).toBeGreaterThanOrEqual(0.1)
    expect(s.born).toBeLessThanOrEqual(2.9 + 1e-9)
  }
})
it('trails about 120 per second while moving, twinkles about 7 per second while still', () => {
  expect(emitSparkles(base).length).toBeGreaterThan(200)          // 1.9 s × 120, minus clipped tails
  const quiet = emitSparkles({ ...base, moving: () => false })
  expect(quiet.length).toBeGreaterThan(8)
  expect(quiet.length).toBeLessThan(20)
})
it('bursts 18 at once, flying outward', () => {
  const burst = emitSparkles({ ...base, moving: () => false, bursts: [2] }).filter(s => s.born === 2)
  expect(burst).toHaveLength(18)
  for (const s of burst) expect(Math.hypot(s.vx, s.vy / (1080 / 1920))).toBeGreaterThanOrEqual(0.18 - 1e-9)
})
it('uses only white and gold, radius 10-28', () => {
  for (const s of emitSparkles(base)) {
    expect(['#FFFFFF', '#FAC775']).toContain(s.color)
    expect(s.radius).toBeGreaterThanOrEqual(10)
    expect(s.radius).toBeLessThanOrEqual(28)
  }
})
it('draws only the sparkles alive at t', () => {
  const fills: number[] = []
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, quadraticCurveTo() {}, fill() { fills.push(1) }, globalAlpha: 1, fillStyle: '' }
  const s = { born: 1, life: 0.5, x: 0.5, y: 0.5, vx: 0, vy: 0, radius: 10, color: '#FFFFFF' }
  drawSparkles(ctx as never, [s, { ...s, born: 2 }], 1.2, 1080, 1920)
  expect(fills).toHaveLength(1)
})
```

- [ ] **Step 2: Run** `npx vitest run src/utils/sparkles.test.ts`. Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement both modules.**
  - **Emission.** `emitSparkles` walks `t` from `start` to `end − 0.1`
    in 1/120 s steps, with one `random(seed)` stream.
    - Trail emission accumulates `120 × step` per step while `moving(t)`;
      twinkle emission accumulates `7 × step` while still. Emit
      `floor(acc)` particles and keep the fraction.
    - Each burst time inside `[start, end − 0.1]` emits 18 particles at
      exactly that time, with radial velocity. y is scaled by `ASPECT`.
    - `spread` is the sprite's radius as a fraction of the frame width.
      Positions come from `path(t)`, offset by ±0.5·spread for trail
      particles and ±0.7·spread for twinkles. y offsets are scaled by
      `ASPECT`. Bursts start at the center.
    - Trail particles get `vy = 0.02`.
    - `life = min(rand(0.40, 0.75), end − born)`. Drop particles whose
      life is under 0.1.
  - **Drawing.** `drawSparkles` draws particles where
    `born ≤ t < born + life`, with `age = t − born` and `s = age / life`.
    - position: `(x + vx·age)·width`, `(y + vy·age)·height`
    - radius:
      `radius·(width/1080)·(1 − 0.7s)·(0.6 + 0.4·sin(age·30))`
    - alpha: `1 − s`
    - shape: the four-quadratic-curve star from the spec

- [ ] **Step 4: Run** `npx vitest run src/utils/sparkles.test.ts src/utils/stickerMotion.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/seededRandom.ts src/utils/sparkles.ts src/utils/sparkles.test.ts src/utils/stickerMotion.ts
git commit -m "feat: deterministic sparkle particles and their star drawing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Fairy motion paths

**Files:**
- Create: `src/utils/fairyMotion.ts`, `src/utils/fairyMotion.test.ts`
- Modify: `src/utils/stickerMotion.ts`. Add `opacity?: number` (default
  1) to `StickerPose`, and export `type Home`.

**Interfaces:**
- Consumes: `StickerPath`, `Home`, `inButtonColumn`, `clamp`, `lerp`
  and `easeInOut` from `stickerMotion.ts` (Task 1).
- Produces:
  - `type FairyMotion = 'glide' | 'peek' | 'loop'`
  - `FAIRY_MOTIONS: FairyMotion[]`
  - `CAMEO_LENGTHS: Record<FairyMotion, number>`, which is
    `{ glide: 1.2, peek: 1.6, loop: 1.4 }`
  - `cameoPath(motion, length, mirror): StickerPath`, with local time
    `0…length`
  - `cameoBursts(motion, length): number[]`, in local times
  - `interface FinaleTiming { fly: number; hover: number; burst: number }`
  - `finaleTiming(duration: number): FinaleTiming | null`
  - `finalePath(home: Home, timing: FinaleTiming): StickerPath`. Local
    time runs `0 … fly + hover + burst`. Opacity falls 1 → 0 over the
    burst.

- [ ] **Step 1: Write the failing tests** in `fairyMotion.test.ts`

```ts
const sample = (path: StickerPath, length: number) => Array.from({ length: 121 }, (_, i) => path((i / 120) * length))
const onFrame = (p: StickerPose) => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1

it.each(FAIRY_MOTIONS.flatMap(m => [[m, false], [m, true]] as const))('%s (mirror %s) starts and ends off-frame or at an edge, never in the button column on-frame', (m, mirror) => {
  const poses = sample(cameoPath(m, CAMEO_LENGTHS[m], mirror), CAMEO_LENGTHS[m])
  expect(onFrame(poses[0])).toBe(false)
  expect(onFrame(poses.at(-1)!) && poses.at(-1)!.y > 0.1).toBe(false)   // peek leaves upward past the top
  for (const p of poses) if (onFrame(p)) expect(inButtonColumn(p)).toBe(false)
})
it('mirrors peek to the right and lifts it 0.16', () => {
  expect(cameoPath('peek', 1.6, true)(0.8)).toMatchObject({ x: expect.closeTo(0.78, 2), y: expect.closeTo(0.36, 2) })
  expect(cameoPath('peek', 1.6, false)(0.8)).toMatchObject({ x: expect.closeTo(0.22, 2), y: expect.closeTo(0.52, 2) })
})
it('reverses glide for the right entry', () => {
  const left = cameoPath('glide', 1.2, false), right = cameoPath('glide', 1.2, true)
  expect(right(0).x).toBeCloseTo(left(1.2).x)
  expect(right(0).y).toBeCloseTo(left(1.2).y)
})
it('time-compresses: the compressed path at s·length equals the nominal at s·nominal', () => {
  expect(cameoPath('loop', 0.9, false)(0.45)).toEqual(cameoPath('loop', 1.4, false)(0.7))
})
it('peek bursts as it leaves', () => {
  expect(cameoBursts('peek', 1.6)).toEqual([1.15])
  expect(cameoBursts('glide', 1.2)).toEqual([])
})
it.each([[3, { fly: 0.6, hover: 2.0, burst: 0.3 }], [1.2, { fly: 0.6, hover: 0.2, burst: 0.3 }], [1.1, { fly: 0.5, hover: 0.2, burst: 0.3 }], [1.0, { fly: 0.4, hover: 0.2, burst: 0.3 }]])('fits the finale into a %s s shot', (d, timing) => {
  const t = finaleTiming(d)!
  expect(t.fly).toBeCloseTo(timing.fly); expect(t.hover).toBeCloseTo(timing.hover); expect(t.burst).toBeCloseTo(timing.burst)
  expect(t.fly + t.hover + t.burst).toBeCloseTo(d - 0.1)
})
it('has no finale under 1 s', () => expect(finaleTiming(0.99)).toBeNull())
it('lands at home after the fly-in and fades out by the end', () => {
  const home = { x: 0.82, y: 0.42, rotation: 8 }
  const timing = finaleTiming(3)!
  const path = finalePath(home, timing)
  expect(path(timing.fly)).toMatchObject({ x: 0.82, y: expect.closeTo(0.42, 1), scale: expect.closeTo(1, 1) })
  expect(path(0).x).toBeGreaterThan(1)                     // right-side home enters from the right
  expect(path(0).y).toBeCloseTo(0.42 - 0.22)
  expect(path(timing.fly + timing.hover + timing.burst).opacity).toBeCloseTo(0)
  expect(finalePath({ x: 0.18, y: 0.42, rotation: -8 }, timing)(0).x).toBeLessThan(0)
})
```

- [ ] **Step 2: Run** `npx vitest run src/utils/fairyMotion.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Write each cameo for its nominal length
  using the coordinates in the spec's "Cameo paths". `cameoPath` maps
  local `t` to `t × nominal / length`. The spec leaves the off-frame end
  points open, so use these for the left entry:
  - **`peek`.** It flies in from (−0.1, 0.58), and its exit ends at
    (0.10, 0.02).
  - **`loop`.** It enters from (−0.1, 0.6), and its exit ends at
    (1.12, 0.35). That line stays above y = 0.5 once x > 0.7.
  - **Mirroring.**
    - `glide`: the right entry is `left(nominal − t')`.
    - `peek` and `loop`: map `x → 1 − x`, `y → y − 0.16`, and negate the
      rotation.
  - **Scale.** Path scales are relative, `1` for normal size.
    `FAIRY_SCALE` is applied by the consumers, not here.
  - **Finale.**
    - It enters from the side nearer home: `x < 0.5` → x = −0.1, else
      1.1. `chest` (x = 0.5) enters from the right.
    - It starts at y = `home.y − 0.22` and eases in to home.
    - Scale goes 0.6 → 1, rotation −25 → `home.rotation`.
    - Hover: y ± 0.012·sin(u·5) and rotation ± 5·sin(u·4).
    - Burst: scale 1 → 1.4 and opacity 1 → 0, linear.

- [ ] **Step 4: Run** `npx vitest run src/utils/fairyMotion.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/fairyMotion.ts src/utils/fairyMotion.test.ts src/utils/stickerMotion.ts
git commit -m "feat: fairy cameo paths (glide, peek, loop) and the finale's landing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Fairy plan

**Files:**
- Create: `src/utils/fairyPlan.ts`, `src/utils/fairyPlan.test.ts`
- Modify: `src/utils/subtitleHook.ts`. Add `fairies?: boolean` to
  `HookOptions`, with the doc comment "Mid-video cameos and the finale
  (default: on)."

**Interfaces:**
- Consumes:
  - Task 1: `emitSparkles`, `Sparkle`
  - Task 2: `cameoPath`, `cameoBursts`, `CAMEO_LENGTHS`, `FAIRY_MOTIONS`,
    `finaleTiming`, `finalePath`
  - `findSticker`, `STICKER_PLACEMENTS` and `DEFAULT_STICKER_PLACEMENT`
    from `subtitleSticker.ts`
  - `stickerSeed` from `stickerMotion.ts`
- Produces:
  - `FAIRY_SCALE = 0.62`
  - `interface FairyAppearance { emoji: string; kind: 'cameo' | 'finale'; start: number; end: number; path: StickerPath; scale: number; sparkles: Sparkle[]; key: string }`
  - `planFairies(shots: { text: string; duration: number }[], hook: Pick<HookOptions, 'sticker' | 'stickerRoute' | 'fairies'>): FairyAppearance[]`
  - `fairiesForShot(plan: FairyAppearance[], shotStart: number, shotDuration: number): FairyAppearance[]`

- [ ] **Step 1: Write the failing tests** in `fairyPlan.test.ts`

```ts
const HOOK = { sticker: 'right' as const, stickerRoute: 0, fairies: true }
const shots = (...lines: [string, number][]) => lines.map(([text, duration]) => ({ text, duration }))
const V = shots(['I put *Vaseline*🧴 on', 2], ['It keeps them 💡 neat', 3], ['No emoji here', 2], ['Try it tonight', 2.5])

it('gives a cameo to middle lines with an emoji and the finale to the last shot', () => {
  const plan = planFairies(V, HOOK)
  expect(plan.map(f => [f.kind, f.emoji])).toEqual([['cameo', '💡'], ['finale', '🧴']])
  expect(plan[0].start).toBeCloseTo(2 + 0.3)                 // CAMEO_DELAY into shot 1
  expect(plan[0].scale).toBe(0.62)
  expect(plan[1]).toMatchObject({ start: 7, end: expect.closeTo(9.4), scale: 1 })
})
it('ignores an emoji on the last line and makes no finale without line 1\'s', () => {
  expect(planFairies(shots(['Hi', 2], ['Bye 👋', 2]), HOOK)).toEqual([])
})
it('needs two shots for a finale', () => expect(planFairies(shots(['Hi 🧴', 3]), HOOK)).toEqual([]))
it.each([{ sticker: 'off' as const }, { fairies: false }])('makes nothing with %o', over => {
  expect(planFairies(V, { ...HOOK, ...over })).toEqual([])
})
it('compresses a cameo that does not fit, and skips one under 0.8 s', () => {
  const tight = planFairies(shots(['A🧴', 2], ['B 💡', 1.3], ['C', 2]), HOOK)[0]
  expect(tight.end - tight.start).toBeCloseTo(0.9)          // 1.3 − 0.3 − 0.1
  expect(planFairies(shots(['A🧴', 2], ['B 💡', 1.19], ['C', 2]), HOOK).map(f => f.kind)).toEqual(['finale'])
})
it('keeps every appearance and every sparkle inside its shot, 0.1 s before the cut', () => {
  for (const f of planFairies(V, HOOK)) {
    const shotEnd = f.kind === 'finale' ? 9.5 : 5
    expect(f.end).toBeLessThanOrEqual(shotEnd - 0.1 + 1e-9)
    for (const s of f.sparkles) expect(s.born + s.life).toBeLessThanOrEqual(f.end + 1e-9)
  }
})
it('is fixed per video and re-rolled by stickerRoute', () => {
  const many = shots(['A🧴', 2], ...Array.from({ length: 8 }, (_, i) => [`line ${i} 💡`, 3] as [string, number]), ['Z', 2])
  expect(planFairies(many, HOOK).map(f => f.key)).toEqual(planFairies(many, HOOK).map(f => f.key))
  expect(planFairies(many, { ...HOOK, stickerRoute: 1 }).map(f => f.key)).not.toEqual(planFairies(many, HOOK).map(f => f.key))
})
it('flies a ZWJ or skin-toned emoji as one glyph, the first of two', () => {
  const plan = planFairies(shots(['A🧴', 2], ['Chef 👨‍🍳 and 👍🏽', 3], ['Z', 2]), HOOK)
  expect(plan[0].emoji).toBe('👨‍🍳')
})
it('moves a shot\'s appearances into its own timeline', () => {
  const [cameo] = fairiesForShot(planFairies(V, HOOK), 2, 3)
  expect(cameo.start).toBeCloseTo(0.3)
  expect(cameo.path(cameo.start)).toEqual(planFairies(V, HOOK)[0].path(2.3))
  expect(cameo.sparkles[0].born).toBeCloseTo(planFairies(V, HOOK)[0].sparkles[0].born - 2)
  expect(fairiesForShot(planFairies(V, HOOK), 5, 2)).toEqual([])
})
```

- [ ] **Step 2: Run** `npx vitest run src/utils/fairyPlan.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Gating.** Return `[]` when `hook.fairies === false`, when
    `(hook.sticker ?? DEFAULT_STICKER_PLACEMENT) === 'off'`, or when
    there are no shots.
  - **Cameos.**
    - For each shot `1 … n − 2` with an emoji, seed with
      `stickerSeed(text, stickerRoute)`. The motion is
      `FAIRY_MOTIONS[floor(r() × 3)]`, and mirror is `r() < 0.5`, from
      `random(seed)`.
    - Fit the length by the spec's rule. The path is shifted to absolute
      time and returns the local pose.
    - Sparkles: `emitSparkles` over `[start, end]` with
      `spread = 0.5 × 200 × FAIRY_SCALE / 1080`. Bursts are the
      `cameoBursts` shifted to absolute time. `moving` is `peek`'s hover
      window → false, else true.
  - **Finale.**
    - Only when `n ≥ 2`, `findSticker(shots[0].text)` is non-null and
      `finaleTiming(D)` is non-null.
    - Home comes from `STICKER_PLACEMENTS`, with y divided by 100.
    - Bursts at `fly` (landing) and `fly + hover`. `moving` is true
      during the fly-in.
  - **Key.** `key = JSON.stringify([kind, emoji, motion, mirror, start.toFixed(3), end.toFixed(3), seed])`.
  - **Slicing.** `fairiesForShot` keeps appearances with
    `start ≥ shotStart − 1e-6` and `end ≤ shotStart + shotDuration + 1e-6`.
    It shifts `start`, `end` and each sparkle's `born` by `−shotStart`,
    and wraps the path as `t => path(t + shotStart)`. The `key` is
    unchanged.

- [ ] **Step 4: Run** `npx vitest run src/utils/fairyPlan.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/fairyPlan.ts src/utils/fairyPlan.test.ts src/utils/subtitleHook.ts
git commit -m "feat: plan the fairies: middle-line cameos and the last shot's finale

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Smaller first-shot sticker with sparkles

**Files:**
- Modify:
  - `src/utils/subtitleSticker.ts`: `STICKER_EMOJI_PX` 220 → 200,
    `STICKER_OUTLINE_PX` 14 → 13
  - `src/utils/stickerMotion.ts`: `PlacedSticker` and `placeSticker`
  - `src/utils/subtitleHook.ts`: `followsFrames`
- Test: `src/utils/stickerMotion.test.ts`, `src/utils/subtitleHook.test.ts`

**Interfaces:**
- Consumes: `emitSparkles` (Task 1), `FairyAppearance` (Task 3).
- Produces:
  - `PlacedSticker` gains `sparkles: Sparkle[]`.
  - `followsFrames(t, hook, firstShotDuration, fairies: FairyAppearance[] = [])`

- [ ] **Step 1: Write the failing tests**

```ts
// stickerMotion.test.ts
it('trails sparkles while travelling, bursts on landing, and all die by the first shot\'s end', () => {
  const s = placeSticker(CUES, { sticker: 'right', stickerMotion: 'wander', stickerRoute: 0 }, 3)!
  expect(s.sparkles.filter(p => Math.abs(p.born - (3 - 0.4)) < 1e-9)).toHaveLength(18)
  for (const p of s.sparkles) expect(p.born + p.life).toBeLessThanOrEqual(3 + 1e-9)
})
it('twinkles a still sticker', () => {
  const s = placeSticker(CUES, { sticker: 'right', stickerMotion: 'none', stickerRoute: 0 }, 3)!
  expect(s.sparkles.length).toBeGreaterThan(10)
  expect(s.sparkles.length).toBeLessThan(30)
})
// subtitleHook.test.ts
it('follows frames for a still sticker (its twinkles) and around each fairy', () => {
  const still = { ...HOOK, sticker: 'right' as const, stickerMotion: 'none' as const }
  expect(followsFrames(1, still, 2)).toBe(true)
  const fairy = { start: 5, end: 6 } as FairyAppearance
  expect(followsFrames(4.95, { ...still, punchIn: null }, 2, [fairy])).toBe(true)
  expect(followsFrames(6.2, { ...still, punchIn: null }, 2, [fairy])).toBe(false)
})
```

- [ ] **Step 2: Run** `npx vitest run src/utils/stickerMotion.test.ts src/utils/subtitleHook.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`placeSticker`** emits over `[0, firstShotDuration]` with seed
    `hash(`sparkles|${seed}`)` and spread `0.5 × 200 / 1080`.
    - With a path: bursts `[duration − LANDING]`, and
      `moving = t < duration − LANDING`.
    - Without: no bursts, and `moving` is always false.
  - **`followsFrames`.**
    - The first-shot condition becomes
      `(punchIn !== null || sticker !== 'off') && t < firstShotDuration + FRAME_FOLLOW_TAIL`.
      The sticker now always animates.
    - OR any fairy with `start − 0.1 ≤ t ≤ end + 0.1`.
  - **Old size assertions.** Update the existing tests that pin the old
    220/14 sizes.

- [ ] **Step 4: Run** `npx vitest run src/utils`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/subtitleSticker.ts src/utils/stickerMotion.ts src/utils/stickerMotion.test.ts src/utils/subtitleHook.ts src/utils/subtitleHook.test.ts
git commit -m "feat: sparkle the first-shot sticker and draw it at 200px

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Compositor draws sparkles, scaled sprites and fading

**Files:**
- Modify: `src/utils/webcodecs/subtitleOverlay.ts`
- Test: `src/utils/webcodecs/subtitleOverlay.test.ts`

**Interfaces:**
- Consumes: `drawSparkles`, `Sparkle` (Task 1), and `StickerPose.opacity` (Task 2).
- Produces: `SubtitleOverlay.sprite` gains `scale?: number` (default 1)
  and `sparkles?: Sparkle[]`.

- [ ] **Step 1: Write the failing test.** Follow the file's existing mock
  style for `createImageBitmap` and `OffscreenCanvas`.

```ts
it('draws a sprite\'s sparkles under it, at its scale, with its opacity', async () => {
  const path = () => ({ x: 0.5, y: 0.5, rotation: 0, scale: 1, opacity: 0.5 })
  const sparkles = [{ born: 0, life: 1, x: 0.5, y: 0.5, vx: 0, vy: 0, radius: 10, color: '#FFFFFF' }]
  const { process } = await createOverlayProcess([{ start: 0, end: 1, image: BLOB, y: 0, sprite: { shadow: BLOB, path, resolution: 1.4, scale: 0.62, sparkles } }])
  process(sample(0.5))
  // the star's fill comes before the sprite's drawImage; scale passed to ctx.scale is 0.62 / 1.4; globalAlpha 0.5 while drawing it
  expect(calls.indexOf('fill')).toBeLessThan(calls.lastIndexOf('drawImage'))
  expect(scales).toContainEqual(0.62 / 1.4)
  expect(alphasAtDraw).toContain(0.5)
})
```

- [ ] **Step 2: Run** `npx vitest run src/utils/webcodecs/subtitleOverlay.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** For each active sprite overlay:
  1. Call `drawSparkles(ctx, sprite.sparkles ?? [], t, width, height)`.
  2. Set `globalAlpha = pose.opacity ?? 1`.
  3. Draw the shadow and the sprite with
     `pose.scale × (sprite.scale ?? 1) / resolution`.
  4. Reset `globalAlpha` to 1.

  A sprite overlay whose sparkles outlive its pose window is impossible
  by construction, so draw only while the overlay is active.

- [ ] **Step 4: Run** `npx vitest run src/utils/webcodecs`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/webcodecs/subtitleOverlay.ts src/utils/webcodecs/subtitleOverlay.test.ts
git commit -m "feat: composite sprite sparkles, sprite scale and fade in the WebCodecs overlay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Burn renders fairies; emoji stripped from every cue

**Files:**
- Modify: `src/utils/burnSubtitles.ts`
  - `SubtitleLook` gains `fairies?: FairyAppearance[]`, with the doc
    comment "in this video's own timeline; default none".
  - `renderSubtitleOverlays`
  - the early return in `burnSubtitles`
- Test: `src/utils/burnSubtitles.test.ts`

**Interfaces:**
- Consumes: `FairyAppearance` (Task 3), `PlacedSticker.sparkles` (Task 4)
  and the sprite fields (Task 5).
- Produces: `SubtitleLook.fairies`, read by Task 7.

- [ ] **Step 1: Write the failing tests** in the existing
  `renderSubtitleOverlays` / `burnSubtitles` describes.

```ts
const FAIRY = { emoji: '💡', kind: 'cameo', start: 0.3, end: 1.5, path: () => ({ x: 0.3, y: 0.5, rotation: 0, scale: 1 }), scale: 0.62, sparkles: [], key: 'k' } as FairyAppearance
it('sends each fairy as a scaled sprite with its sparkles over its window', async () => {
  stubCanvas()
  const [fairy] = await renderSubtitleOverlays([], { ...LOOK, fairies: [FAIRY] })
  expect([fairy.start, fairy.end]).toEqual([0.3, 1.5])
  expect(fairy.sprite).toMatchObject({ scale: 0.62, sparkles: [], resolution: STICKER_MAX_SCALE })
})
it('gives the travelling sticker its sparkles', async () => { /* hook cue with 🧴, orbit → sticker.sprite.sparkles.length > 0 */ })
it('leaves fairies and sparkles out for ffmpeg', async () => {
  stubCanvas()
  expect(await renderSubtitleOverlays([], { ...LOOK, fairies: [FAIRY] }, { still: true })).toEqual([])
})
it('never draws an emoji in a normal cue\'s text', async () => {
  const { drawn } = stubCanvas()
  await renderSubtitleOverlays([{ id: 'b', start: 2, end: 3, en: 'It keeps them 💡 neat 👍🏽', ja: 'きれい', variant: 'normal' }], LOOK)
  expect(drawn.some(d => /\p{Extended_Pictographic}/u.test(d.text))).toBe(false)
})
it('burns a video that only has fairies', async () => {
  await burnSubtitles(new Blob(['v']), [], { ...LOOK, fairies: [FAIRY] })
  expect(burnSubtitlesWebCodecs).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run** `npx vitest run src/utils/burnSubtitles.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Emoji.** Apply `stripStickers` to every cue's `en`.
  - **Sticker overlay.** It gets `sparkles: sticker.sparkles` on its
    sprite. In the still branch it stays a plain image.
  - **Fairies.** Unless `still`, each fairy pushes
    `{ start, end, image, y: 0, sprite: { shadow, path, resolution: STICKER_MAX_SCALE, scale: f.scale, sparkles: f.sparkles } }`,
    using `renderStickerSprite(f.emoji)`.
  - **Early return.** `burnSubtitles` returns the input unchanged only if
    there are no translated cues, no first-shot extras and no fairies.

- [ ] **Step 4: Run** `npx vitest run src/utils/burnSubtitles.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/burnSubtitles.ts src/utils/burnSubtitles.test.ts
git commit -m "feat: burn the fairies and the sticker's sparkles; keep every emoji out of subtitle text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Per-shot burns carry the fairy plan

**Files:**
- Modify:
  - `src/utils/shotEncoding.ts`: `burnRequest`, `shotBurnRequests` and
    `burnSubtitlesByShot`
  - `src/pages/FinalizePage.tsx`: the two call sites at about lines 511
    and 834. Pass `shotCueInputs.map(s => s.text)`, and add
    `shotCueInputs` to the prefetch effect's deps.
- Test: `src/utils/shotEncoding.test.ts`

**Interfaces:**
- Consumes: `planFairies`, `fairiesForShot` (Task 3) and `SubtitleLook.fairies` (Task 6).
- Produces:
  - `shotBurnRequests(clips, cues, position, hook, shotTexts: string[])`
  - `burnSubtitlesByShot(cache, clips, combinedBlob, cues, position, hook, shotTexts: string[], onProgress?, signal?)`

- [ ] **Step 1: Write the failing tests**

```ts
const FAIRY_HOOK: HookOptions = { ...HOOK, sticker: 'right', stickerMotion: 'none', fairies: true }
const TEXTS = ['A 🧴', 'B 💡', 'C']
const CLIPS = [clip('s1', 0, 2), clip('s2', 0, 3), clip('s3', 0, 2.5)]

it('burns a shot that only has a fairy, with the fairy in its own timeline', () => {
  const [, middle] = shotBurnRequests(CLIPS, [], 50, FAIRY_HOOK, TEXTS)
  expect(middle.key).not.toBe(normalizeRequest(CLIPS[1]).key)
})
it('re-keys a shot when the fairies are turned off', () => {
  const on = shotBurnRequests(CLIPS, [], 50, FAIRY_HOOK, TEXTS)[1].key
  const off = shotBurnRequests(CLIPS, [], 50, { ...FAIRY_HOOK, fairies: false }, TEXTS)[1].key
  expect(off).not.toBe(on)
})
it('copes with fewer texts than clips', () => {
  expect(() => shotBurnRequests(CLIPS, [], 50, FAIRY_HOOK, ['A 🧴'])).not.toThrow()
})
it('gives the whole-video fallback the full plan', async () => {
  vi.mocked(canUseWebCodecs).mockResolvedValue(false)
  await burnSubtitlesByShot(new ShotEncodeCache(), CLIPS, JOINED, [], 50, FAIRY_HOOK, TEXTS)
  const look = vi.mocked(burnModule.burnSubtitles).mock.calls[0][2]
  expect(look.fairies!.map(f => f.kind)).toEqual(['cameo', 'finale'])
})
```

Update the existing calls in this test file to pass `[]` for `shotTexts`.

- [ ] **Step 2: Run** `npx vitest run src/utils/shotEncoding.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Plan.** `shotBurnRequests` builds
    `shots = clips.map((c, i) => ({ text: shotTexts[i] ?? '', duration: c.end − c.start }))`
    and calls `planFairies(shots, hook)` once.
  - **Per shot.** Each `look` gets
    `fairies: fairiesForShot(plan, offset, duration)`.
  - **`burnRequest`.**
    - It returns the normalize request only when there is no translated
      cue, no extras and no fairies.
    - The `placement` JSON adds `'sparkles-v1'` and `fairies.map(f => f.key)`.
  - **`burnSubtitlesByShot`.**
    - The early return also requires an empty plan.
    - The whole-video fallback passes `fairies: plan`.

- [ ] **Step 4: Run** `npx vitest run src/utils/shotEncoding.test.ts && npx tsc -b`. Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/shotEncoding.ts src/utils/shotEncoding.test.ts src/pages/FinalizePage.tsx
git commit -m "feat: give each shot's burn its fairies, and the whole-video fallback the full plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: 妖精 setting

**Files:**
- Modify:
  - `src/hooks/useSettings.ts`: `fairyEnabled: boolean`, with the doc
    comment "Mid-video cameos and the finale (妖精).", default `true`
  - `src/utils/subtitleHook.ts`: `HookSettings` includes
    `'fairyEnabled'`, and `hookOptionsOf` maps it as
    `fairies: settings.fairyEnabled ?? true`
  - `src/pages/FinalizePage.tsx`: `hookSettings` memo and deps
  - `src/components/SubtitleWorkflow.tsx`: the sticker section
- Test: `src/hooks/useSettings.test.ts`, `src/components/SubtitleWorkflow.test.tsx`

**Interfaces:**
- Consumes: `HookOptions.fairies` (Task 3).
- Produces: the `fairyEnabled` setting.

- [ ] **Step 1: Write the failing tests**

```ts
// useSettings.test.ts: add fairyEnabled: true to the expected defaults object.
// SubtitleWorkflow.test.tsx (add fairyEnabled: true to its settings fixture):
it('turns the fairies off and on', async () => {
  // render with stickerPlacement 'right'; click the 'オフ' button in the group labelled '妖精（途中と締め）'
  expect(onHookSettingsChange).toHaveBeenLastCalledWith({ fairyEnabled: false })
})
it('hides the fairy switch when the sticker is off', () => {
  // render with stickerPlacement 'off' → queryByRole('group', { name: '妖精（途中と締め）' }) is null
})
it('offers ルートを変える with a still sticker when fairies are on', () => {
  // stickerMotion 'none', fairyEnabled true → button 'ルートを変える' is present
})
```

Also update the existing `hook: {...}` expectation at about line 499 to
include `fairies: true`.

- [ ] **Step 2: Run** `npx vitest run src/hooks/useSettings.test.ts src/components/SubtitleWorkflow.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Placement.** Add the switch after the ステッカーの動き group, inside
    `stickerPlacement !== 'off'`.
  - **Switch.**
    - Section title: 妖精（途中と締め）
    - A `role="group"` of two `positionBtn` buttons, オン and オフ, with
      `aria-pressed`
    - Hint: `途中の行に入れた絵文字が妖精になって横切り、最後のショットで1行目の絵文字が戻ってきます`
  - **ルートを変える.** Show its button (and the existing travel hint
    only when the motion is not `none`) when
    `stickerMotion !== 'none' || fairyEnabled`.

- [ ] **Step 4: Run** `npx vitest run src/hooks src/components/SubtitleWorkflow.test.tsx && npx tsc -b`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSettings.ts src/hooks/useSettings.test.ts src/utils/subtitleHook.ts src/pages/FinalizePage.tsx src/components/SubtitleWorkflow.tsx src/components/SubtitleWorkflow.test.tsx
git commit -m "feat: 妖精 on/off setting for the mid-video cameos and the finale

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Preview shows fairies and sparkles

**Files:**
- Modify:
  - `src/components/SubtitleOverlayPreview.tsx`
  - `src/components/SubtitleOverlayPreview.module.css`: add a
    `.sparkles` canvas rule with `position: absolute; inset: 0;
    pointer-events: none`
  - `src/components/SubtitleWorkflow.tsx`
- Test: `src/components/SubtitleOverlayPreview.test.tsx`

**Interfaces:**
- Consumes: `planFairies`, `FairyAppearance` and `FAIRY_SCALE` (Task 3),
  `drawSparkles` (Task 1), `PlacedSticker.sparkles` (Task 4) and
  `followsFrames(…, fairies)` (Task 4).
- Produces:
  - the prop `fairies?: FairyAppearance[]` on `SubtitleOverlayPreview`
  - a `StickerSprite` element, local to the file, with props
    `{ emoji, pose, scale, testId }`

- [ ] **Step 1: Write the failing tests**

```ts
const FAIRY = { emoji: '💡', kind: 'cameo', start: 2.3, end: 3.5, path: () => ({ x: 0.3, y: 0.5, rotation: 0, scale: 1 }), scale: 0.62, sparkles: [], key: 'k' } as FairyAppearance
it('shows a fairy only during its window', () => {
  const { rerender } = render(<SubtitleOverlayPreview cues={[]} position={72} currentTime={2.5} fairies={[FAIRY]} />)
  expect(screen.getByTestId('subtitle-fairy')).toHaveTextContent('💡')
  rerender(<SubtitleOverlayPreview cues={[]} position={72} currentTime={3.6} fairies={[FAIRY]} />)
  expect(screen.queryByTestId('subtitle-fairy')).toBeNull()
})
it('fades the finale with its pose opacity', () => { /* path returns opacity 0.4 → style.opacity '0.4' */ })
it('keeps every emoji out of a normal cue\'s text', () => { /* normal cue 'It keeps them 💡 neat' → overlay box text has no pictograph */ })
it('draws the sticker at 200px', () => { /* existing sticker test: fontSize is `${200 / SUBTITLE_REFERENCE_WIDTH * 100}cqw` */ })
```

- [ ] **Step 2: Run** `npx vitest run src/components/SubtitleOverlayPreview.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`StickerSprite`.** Factor the sticker `<span>` into it. Its
    `transform` scale is `pose.scale × scale`, and its `opacity` is
    `pose.opacity ?? 1`.
  - **Fairies.** Render the active fairies with
    `testId="subtitle-fairy"`.
  - **Sparkle canvas.**
    - Add a `<canvas className={styles.sparkles}>`. Size it from a
      `ResizeObserver` × `devicePixelRatio`.
    - In a `useEffect` on `[currentTime, sticker, fairies, size]`: clear
      it, then `drawSparkles` the sticker's sparkles (while the first shot
      shows it) and each active fairy's.
    - Skip drawing when `getContext('2d')` is null (jsdom).
  - **Emoji.** Apply `stripStickers` to every cue before `layoutCue`.
  - **Rendering.** Return `null` only when there is no cue, no sticker
    and no fairy.
  - **`SubtitleWorkflow`.**
    - `const fairies = useMemo(() => planFairies(shotCueInputs, hook), [shotCueInputs, hook])`.
      `hook` must be memoized, or the memo is keyed on its fields.
    - Pass `fairies` to `<SubtitleOverlayPreview>` and to
      `followsFrames(t, hook, firstShotDuration, fairies)`.

- [ ] **Step 4: Run** `npx vitest run src/components && npx tsc -b`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SubtitleOverlayPreview.tsx src/components/SubtitleOverlayPreview.module.css src/components/SubtitleOverlayPreview.test.tsx src/components/SubtitleWorkflow.tsx
git commit -m "feat: preview the fairies and the sparkles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Claude puts emoji on middle lines

**Files:**
- Modify: `server/mcp.ts` (the `DESCRIPTION` line about emoji)
- Test: `server/mcp.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('asks for at most two middle-line emoji and none on the last line', () => {
  expect(DESCRIPTION_TEXT).toContain('途中の行（1行目と最終行以外）のうち、具体的なモノや話の山場が出てくる行に、合計で最大2行まで絵文字を1つずつ入れます')
  expect(DESCRIPTION_TEXT).toContain('最終行には絵文字を入れません')
  expect(DESCRIPTION_TEXT).not.toContain('2行目以降には絵文字を入れません')
})
```

Use however the existing test reads the tool description.

- [ ] **Step 2: Run** `npx vitest run server/mcp.test.ts`. Expected: FAIL.

- [ ] **Step 3: Replace the line's final sentence** 「2行目以降には絵文字を入れません。」 with this text:

  「途中の行（1行目と最終行以外）のうち、具体的なモノや話の山場が出てくる行に、合計で最大2行まで絵文字を1つずつ入れます。これも字幕の文字には出ず、そのショットで小さな妖精として一瞬横切ります。最終行には絵文字を入れません（1行目の絵文字が最後のショットで自動的に戻ってきます）。」

- [ ] **Step 4: Run** `npx vitest run server/mcp.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/mcp.ts server/mcp.test.ts
git commit -m "feat: Claude marks up to two middle lines with a fairy emoji

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Whole-branch verification

- [ ] **Step 1:** Run
  `npx tsc -b && npm run lint && npx vitest run && npm run build`.
  Expected: everything passes. `vitest` reports 0 failed.
- [ ] **Step 2: Check it in the browser.**
  - Add a temporary `npm --prefix .claude/worktrees/sticker-fairies run dev`
    entry to the main checkout's `.claude/launch.json`, then
    `preview_start` it.
  - Open a script whose lines are `A 🧴 / B 💡 / C / D`, combine it, and
    on the subtitle step play the preview.
  - Confirm the fairy and its sparkles on shot 2, the finale on shot 4
    and the sticker's sparkles on shot 1, and that there are no console
    errors.
  - Take a screenshot.
  - Remove the temporary launch entry.
- [ ] **Step 3: Note for the user.** Ask the user to check the sizes and
  the finale's timing on an iPhone after the deploy, relaunching the
  home-screen app first, since a stale PWA can show the old version.
