# Hook on the First Shot — PR 1: Hook Style, First Frame, Emphasis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the first shot's subtitles in a big, dark-banded "hook" style from the video's very first frame, at their own position, and let `*word*` paint a word yellow in any subtitle. Items 1–3 of the spec.

**Architecture:** Hook-ness is derived at render time by one pure function, `styleCues`, on the joined video's timeline. It marks cues starting within the first shot `D` seconds as `'hook'` and moves the earliest one to 0 s. The preview, the per-shot burn and the whole-video burn all run cues through it, so they agree. Layout gains a `variant` (hook fonts and band opacity) and emphasis runs. Emphasis markers are stripped before wrapping and mapped back onto the wrapped lines. The hook settings live in `useSettings` and flow from `FinalizePage` into `SubtitleWorkflow`.

**Tech Stack:** React 18 + TypeScript 5.6, Vitest 2 + Testing Library (jsdom), Canvas 2D, Mediabunny (WebCodecs), ffmpeg.wasm.

**Spec:** `docs/superpowers/specs/2026-10-08-hook-first-shot-design.md`

## Global Constraints

- Hook EN style: `{ weight: 'bold', maxPx: 100, minPx: 72, maxLines: 3, lineHeight: 1.2 }`. Hook JA style: `{ weight: 'normal', maxPx: 75, minPx: 57, maxLines: 3, lineHeight: 1.4 }`.
- Band opacity: normal `0.55`, hook `0.8`.
- Emphasis color: `#FFD60A`. Marker regex: `/\*(?!\s)([^*\n]+?)(?<!\s)\*/g`. Unpaired or space-padded `*` stay literal.
- Hook cue ⇔ `start < D` on the joined timeline, decided **before** splitting per shot. `D` = `combinedClips[0].end - combinedClips[0].start`.
- The earliest hook cue starts at 0 only while the hook style is on.
- New settings defaults: `hookStyleEnabled: true`, `hookPosition: SUBTITLE_POSITION_CENTER` (50).
- Cues with `ja === null` are never burned (unchanged).
- Type-check with `npx tsc -b` (never `tsc --noEmit -p .`: it checks nothing in this repo).
- Work in the worktree `.claude/worktrees/hook-first-shot` (branch `feat/hook-first-shot`). Other sessions share the main checkout, so never switch its branch.
- UI copy is Japanese; code comments follow the surrounding style (short, explain *why*).

---

### Task 0: Worktree setup

**Files:** none

- [ ] **Step 1: Install dependencies in the worktree**

Run (from `.claude/worktrees/hook-first-shot`): `npm ci`
Expected: completes, and `public/ffmpeg/` is populated by `postinstall`.

- [ ] **Step 2: Baseline**

Run: `npx vitest run && npx tsc -b`
Expected: all tests pass, and tsc prints nothing.

---

### Task 1: Emphasis parsing

**Files:**
- Create: `src/utils/subtitleEmphasis.ts`
- Create: `src/utils/subtitleEmphasis.test.ts`
- Modify: `src/utils/subtitleCues.ts` (`buildClaudePrompt`)
- Modify: `src/utils/subtitleCues.test.ts`

**Interfaces:**
- Produces:
  - `interface Emphasis { text: string; emphasized: boolean[] }`
  - `interface Run { text: string; emphasized: boolean }`
  - `const EMPHASIS_COLOR = '#FFD60A'`
  - `parseEmphasis(raw: string): Emphasis`
  - `stripEmphasis(raw: string): string`
  - `emphasisRuns(lines: string[], emphasis: Emphasis): Run[][]`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/subtitleEmphasis.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { emphasisRuns, parseEmphasis, stripEmphasis } from './subtitleEmphasis'

describe('parseEmphasis', () => {
  it('removes the markers and flags what they enclosed', () => {
    const e = parseEmphasis('a *big* deal')
    expect(e.text).toBe('a big deal')
    expect(e.emphasized).toEqual([false, false, true, true, true, false, false, false, false, false])
  })

  it('handles several emphasized words', () => {
    const e = parseEmphasis('*one* and *two*')
    expect(e.text).toBe('one and two')
    expect(emphasisRuns([e.text], e)).toEqual([[
      { text: 'one', emphasized: true },
      { text: ' and ', emphasized: false },
      { text: 'two', emphasized: true },
    ]])
  })

  it('leaves an unpaired asterisk as typed', () => {
    const e = parseEmphasis('a 5* rating')
    expect(e.text).toBe('a 5* rating')
    expect(e.emphasized.every(flag => !flag)).toBe(true)
  })

  it('leaves asterisks around spaces as typed, e.g. arithmetic', () => {
    expect(parseEmphasis('5 * 3 * 2').text).toBe('5 * 3 * 2')
  })

  it('does not read ** as an empty emphasis', () => {
    expect(parseEmphasis('a ** b').text).toBe('a ** b')
  })
})

describe('stripEmphasis', () => {
  it('returns the text without its markers', () => {
    expect(stripEmphasis("I still *carry a torch*, don't I?")).toBe("I still carry a torch, don't I?")
  })
})

describe('emphasisRuns', () => {
  it('splits wrapped lines into runs, across the line break', () => {
    const e = parseEmphasis('I still *carry a torch* for him')
    expect(emphasisRuns(['I still carry', 'a torch for him'], e)).toEqual([
      [{ text: 'I still ', emphasized: false }, { text: 'carry', emphasized: true }],
      [{ text: 'a torch', emphasized: true }, { text: ' for him', emphasized: false }],
    ])
  })

  it('follows the text through collapsed whitespace', () => {
    const e = parseEmphasis('  so   *very*\n tired ')
    expect(emphasisRuns(['so very tired'], e)).toEqual([[
      { text: 'so ', emphasized: false },
      { text: 'very', emphasized: true },
      { text: ' tired', emphasized: false },
    ]])
  })

  it('works for Japanese lines, which break without a space', () => {
    const e = parseEmphasis('私は*本気*だったの')
    expect(emphasisRuns(['私は本気', 'だったの'], e)).toEqual([
      [{ text: '私は', emphasized: false }, { text: '本気', emphasized: true }],
      [{ text: 'だったの', emphasized: false }],
    ])
  })
})
```

Append to `src/utils/subtitleCues.test.ts`. Add `buildClaudePrompt` to its existing import from `./subtitleCues` if it isn't already there.

```ts
describe('buildClaudePrompt emphasis', () => {
  it('sends the English without its *emphasis* markers', () => {
    const prompt = buildClaudePrompt([{ id: 'c0', start: 0, end: 1, en: 'I *love* it', ja: null }])
    expect(prompt).toContain('1. I love it')
    expect(prompt).not.toContain('*love*')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/subtitleEmphasis.test.ts src/utils/subtitleCues.test.ts`
Expected: FAIL. `subtitleEmphasis` can't be resolved, and the prompt still contains `*love*`.

- [ ] **Step 3: Implement**

Create `src/utils/subtitleEmphasis.ts`:

```ts
/**
 * `*word*` in subtitle text paints that word yellow. The markers are taken
 * out before the text is wrapped, so line breaks are measured on exactly
 * what gets drawn, and only which characters were inside them is kept.
 */

export interface Emphasis {
  /** The text with its `*…*` markers removed. */
  text: string
  /** Whether each UTF-16 unit of `text` was inside a marker pair. */
  emphasized: boolean[]
}

/** A stretch of one line drawn in a single color. */
export interface Run {
  text: string
  emphasized: boolean
}

export const EMPHASIS_COLOR = '#FFD60A'

// A `*…*` pair whose content neither starts nor ends with whitespace, so
// "5 * 3 * 2" or a lone "5*" stays as typed.
const MARKER = /\*(?!\s)([^*\n]+?)(?<!\s)\*/g

export function parseEmphasis(raw: string): Emphasis {
  let text = ''
  const emphasized: boolean[] = []
  const push = (s: string, flag: boolean) => {
    text += s
    for (let i = 0; i < s.length; i++) emphasized.push(flag)
  }
  const marker = new RegExp(MARKER.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = marker.exec(raw)) !== null) {
    push(raw.slice(last, m.index), false)
    push(m[1], true)
    last = m.index + m[0].length
  }
  push(raw.slice(last), false)
  return { text, emphasized }
}

export function stripEmphasis(raw: string): string {
  return parseEmphasis(raw).text
}

/**
 * Split wrapped lines into plain and emphasized runs. The lines are
 * `emphasis.text` with its whitespace collapsed and broken up (see
 * wrapText), so walking both side by side, skipping whitespace in the text
 * that a line doesn't have, finds each drawn character's flag.
 */
export function emphasisRuns(lines: string[], emphasis: Emphasis): Run[][] {
  const { text, emphasized } = emphasis
  let pos = 0
  return lines.map(line => {
    const runs: Run[] = []
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      while (pos < text.length && text[pos] !== ch && /\s/.test(text[pos])) pos++
      const flag = emphasized[pos] ?? false
      pos++
      const last = runs[runs.length - 1]
      if (last && last.emphasized === flag) last.text += ch
      else runs.push({ text: ch, emphasized: flag })
    }
    return runs
  })
}
```

In `src/utils/subtitleCues.ts`, import the helper and use it in `buildClaudePrompt`:

```ts
import { stripEmphasis } from './subtitleEmphasis'
```

```ts
export function buildClaudePrompt(cues: SubtitleCue[]): string {
  // The *emphasis* markers are for the burn-in only, not for translating.
  const lines = cues.map((cue, i) => `${i + 1}. ${stripEmphasis(cue.en)}`).join('\n')
```

(The rest of `buildClaudePrompt` stays as is.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/subtitleEmphasis.test.ts src/utils/subtitleCues.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/subtitleEmphasis.ts src/utils/subtitleEmphasis.test.ts src/utils/subtitleCues.ts src/utils/subtitleCues.test.ts
git commit -m "feat: parse *emphasis* in subtitle text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Hook variant and emphasis runs in the layout

**Files:**
- Modify: `src/utils/subtitleLayout.ts`
- Modify: `src/utils/subtitleLayout.test.ts`

**Interfaces:**
- Consumes: `parseEmphasis`, `emphasisRuns`, `Run` from Task 1.
- Produces:
  - `type CueVariant = 'normal' | 'hook'`
  - `interface TextStyle` (now exported)
  - `HOOK_EN_STYLE`, `HOOK_JA_STYLE`
  - `SUBTITLE_BOX_OPACITY: Record<CueVariant, number>`
  - `textStylesFor(variant: CueVariant): { en: TextStyle; ja: TextStyle }`
  - `TextBlockLayout.runs: Run[][]`
  - `layoutCue(cue, measure, variant: CueVariant = 'normal'): CueLayout`

- [ ] **Step 1: Write the failing tests**

In `src/utils/subtitleLayout.test.ts`, extend the import:

```ts
import {
  EN_STYLE,
  HOOK_EN_STYLE,
  HOOK_JA_STYLE,
  JA_STYLE,
  MeasureText,
  SUBTITLE_BOX_OPACITY,
  SUBTITLE_TEXT_WIDTH,
  layoutCue,
  tokenize,
  wrapText,
} from './subtitleLayout'
```

Append:

```ts
describe('layoutCue hook variant', () => {
  it('uses the hook styles', () => {
    expect(HOOK_EN_STYLE).toMatchObject({ weight: 'bold', maxPx: 100, minPx: 72, maxLines: 3 })
    expect(HOOK_JA_STYLE).toMatchObject({ maxPx: 75, minPx: 57, maxLines: 3 })
  })

  it('lays a short hook cue out at the full hook sizes', () => {
    const layout = layoutCue({ en: 'Hello there', ja: 'こんにちは' }, measure, 'hook')
    expect(layout.en).toMatchObject({ fontPx: 100, lines: ['Hello there'] })
    expect(layout.ja).toMatchObject({ fontPx: 75, lines: ['こんにちは'] })
  })

  it('shrinks a hook cue only until it fits three lines', () => {
    // Four lines at 100px with the test measure; three fit somewhere above 72px.
    const layout = layoutCue({ en: 'I was sure the other singer would go through.', ja: null }, measure, 'hook')
    expect(layout.en.lines.length).toBeLessThanOrEqual(3)
    expect(layout.en.fontPx).toBeGreaterThan(72)
    expect(layout.en.fontPx).toBeLessThan(100)
  })

  it('never shrinks a hook cue below 72px', () => {
    expect(layoutCue({ en: 'word '.repeat(20), ja: null }, measure, 'hook').en.fontPx).toBe(72)
  })

  it('gives a hook cue a taller box and a darker band than a normal one', () => {
    const cue = { en: 'Hello there', ja: 'こんにちは' }
    expect(layoutCue(cue, measure, 'hook').height).toBeGreaterThan(layoutCue(cue, measure).height)
    expect(SUBTITLE_BOX_OPACITY).toEqual({ normal: 0.55, hook: 0.8 })
  })
})

describe('layoutCue emphasis', () => {
  it('wraps the text without its markers and keeps which words are emphasized', () => {
    const layout = layoutCue({ en: 'I *carry a torch*', ja: '*本気*なの' }, measure)
    expect(layout.en.lines).toEqual(['I carry a torch'])
    expect(layout.en.runs).toEqual([[
      { text: 'I ', emphasized: false },
      { text: 'carry a torch', emphasized: true },
    ]])
    expect(layout.ja!.runs).toEqual([[
      { text: '本気', emphasized: true },
      { text: 'なの', emphasized: false },
    ]])
  })

  it('gives plain text a single plain run per line', () => {
    expect(layoutCue({ en: 'Hello there', ja: null }, measure).en.runs).toEqual([
      [{ text: 'Hello there', emphasized: false }],
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/subtitleLayout.test.ts`
Expected: FAIL (`HOOK_EN_STYLE` is undefined, and `runs` is undefined).

- [ ] **Step 3: Implement**

In `src/utils/subtitleLayout.ts`:

1. Add an import after the existing `SubtitleCue` import:

```ts
import { emphasisRuns, parseEmphasis, type Run } from './subtitleEmphasis'
```

2. Export `TextStyle` (change `interface TextStyle {` to `export interface TextStyle {`). Then add after `JA_STYLE`:

```ts
/**
 * The first shot's cues, drawn to stop the scroll: about 1.6x the English
 * and 1.5x the Japanese, on a darker band (see subtitleHook).
 */
export type CueVariant = 'normal' | 'hook'
export const HOOK_EN_STYLE: TextStyle = { weight: 'bold', maxPx: 100, minPx: 72, maxLines: 3, lineHeight: 1.2 }
export const HOOK_JA_STYLE: TextStyle = { weight: 'normal', maxPx: 75, minPx: 57, maxLines: 3, lineHeight: 1.4 }
/** Opacity of the black band behind a cue. */
export const SUBTITLE_BOX_OPACITY: Record<CueVariant, number> = { normal: 0.55, hook: 0.8 }

export function textStylesFor(variant: CueVariant): { en: TextStyle; ja: TextStyle } {
  return variant === 'hook' ? { en: HOOK_EN_STYLE, ja: HOOK_JA_STYLE } : { en: EN_STYLE, ja: JA_STYLE }
}
```

3. Replace `TextBlockLayout`:

```ts
export interface TextBlockLayout {
  fontPx: number
  lines: string[]
  /** `lines` split into plain and emphasized (`*…*`) runs, markers removed. */
  runs: Run[][]
  lineHeightPx: number
}
```

4. Replace `layoutBlock` and `layoutCue`:

```ts
function layoutBlock(raw: string, style: TextStyle, measure: MeasureText): TextBlockLayout {
  const emphasis = parseEmphasis(raw)
  let px = style.maxPx
  let lines: string[] = []
  for (; px >= style.minPx; px -= 2) {
    const font = fontFor(style, px)
    lines = wrapText(emphasis.text, SUBTITLE_TEXT_WIDTH, s => measure(s, font))
    if (lines.length <= style.maxLines) break
  }
  px = Math.max(px, style.minPx)
  return { fontPx: px, lines, runs: emphasisRuns(lines, emphasis), lineHeightPx: Math.round(px * style.lineHeight) }
}

/** Lay out one cue's bilingual subtitle box at the 1080px reference width. */
export function layoutCue(
  cue: Pick<SubtitleCue, 'en' | 'ja'>,
  measure: MeasureText,
  variant: CueVariant = 'normal',
): CueLayout {
  const styles = textStylesFor(variant)
  const en = layoutBlock(cue.en, styles.en, measure)
  const ja = cue.ja ? layoutBlock(cue.ja, styles.ja, measure) : null
  let height = SUBTITLE_BOX_PADDING_Y * 2 + en.lines.length * en.lineHeightPx
  if (ja) height += SUBTITLE_BLOCK_GAP + ja.lines.length * ja.lineHeightPx
  return { en, ja, height }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/subtitleLayout.test.ts src/data/subtitleSamples.test.ts`
Expected: PASS (the samples test still uses the normal variant).

- [ ] **Step 5: Commit**

```bash
git add src/utils/subtitleLayout.ts src/utils/subtitleLayout.test.ts
git commit -m "feat: lay out hook-style cues and emphasized runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hook cue model and settings

**Files:**
- Create: `src/utils/subtitleHook.ts`
- Create: `src/utils/subtitleHook.test.ts`
- Modify: `src/hooks/useSettings.ts`
- Modify: `src/hooks/useSettings.test.ts`

**Interfaces:**
- Consumes: `CueVariant` (Task 2), `SubtitleCue`, `AppSettings`.
- Produces:
  - `type StyledCue = SubtitleCue & { variant: CueVariant }`
  - `interface HookOptions { style: boolean; position: SubtitlePosition }`
  - `type HookSettings = Pick<AppSettings, 'hookStyleEnabled' | 'hookPosition'>`
  - `hookOptionsOf(settings: HookSettings): HookOptions`
  - `styleCues(cues: SubtitleCue[], firstShotDuration: number | null, hookStyle: boolean): StyledCue[]`
  - `AppSettings.hookStyleEnabled: boolean` (default `true`)
  - `AppSettings.hookPosition: number` (default `SUBTITLE_POSITION_CENTER`)

- [ ] **Step 1: Write the failing tests**

Create `src/utils/subtitleHook.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hookOptionsOf, styleCues } from './subtitleHook'
import type { SubtitleCue } from './subtitleCues'

const cue = (id: string, start: number, end: number): SubtitleCue => ({ id, start, end, en: id, ja: `${id}-ja` })

describe('styleCues', () => {
  it('marks the cues starting within the first shot as hook cues', () => {
    const styled = styleCues([cue('a', 0, 1), cue('b', 1, 2.5), cue('c', 2.5, 4)], 2.5, true)
    expect(styled.map(c => c.variant)).toEqual(['hook', 'hook', 'normal'])
  })

  it('keeps a cue running on past the first shot a hook cue, end untouched', () => {
    expect(styleCues([cue('a', 0, 3)], 2, true)[0]).toMatchObject({ variant: 'hook', start: 0, end: 3 })
  })

  it('starts the first hook cue at 0 and leaves the others as timed', () => {
    const styled = styleCues([cue('a', 0.3, 1), cue('b', 1.1, 1.8), cue('c', 2.2, 3)], 2, true)
    expect(styled.map(c => [c.start, c.end])).toEqual([[0, 1], [1.1, 1.8], [2.2, 3]])
  })

  it('leaves every cue normal and as timed with the hook style off', () => {
    const cues = [cue('a', 0.3, 1)]
    expect(styleCues(cues, 2, false)).toEqual([{ ...cues[0], variant: 'normal' }])
  })

  it('has no hook cues without a first shot', () => {
    expect(styleCues([cue('a', 0.3, 1)], null, true)).toEqual([{ ...cue('a', 0.3, 1), variant: 'normal' }])
  })

  it('does not change the cues it was given', () => {
    const cues = [cue('a', 0.3, 1)]
    styleCues(cues, 2, true)
    expect(cues[0].start).toBe(0.3)
  })
})

describe('hookOptionsOf', () => {
  it('reads the hook settings', () => {
    expect(hookOptionsOf({ hookStyleEnabled: false, hookPosition: 40 })).toEqual({ style: false, position: 40 })
  })
})
```

In `src/hooks/useSettings.test.ts`:
- Add the import `import { SUBTITLE_POSITION_CENTER } from '../utils/subtitlePosition'` (alongside the existing `SUBTITLE_POSITION_BOTTOM` import: `import { SUBTITLE_POSITION_BOTTOM, SUBTITLE_POSITION_CENTER } from '../utils/subtitlePosition'`).
- Extend `DEFAULTS` with `hookStyleEnabled: true, hookPosition: SUBTITLE_POSITION_CENTER`.
- Append inside `describe('useSettings', …)`:

```ts
  it('stores the hook settings, defaulting older stored settings to them', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false }))
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toMatchObject({ hookStyleEnabled: true, hookPosition: SUBTITLE_POSITION_CENTER })
    act(() => { result.current[1]({ hookStyleEnabled: false, hookPosition: 30 }) })
    expect(JSON.parse(localStorage.getItem('teleprompter_settings')!)).toMatchObject({
      hookStyleEnabled: false,
      hookPosition: 30,
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/subtitleHook.test.ts src/hooks/useSettings.test.ts`
Expected: FAIL (the module is missing, and the defaults lack the hook keys).

- [ ] **Step 3: Implement**

In `src/hooks/useSettings.ts`:
- Change the import to `import { SUBTITLE_POSITION_BOTTOM, SUBTITLE_POSITION_CENTER } from '../utils/subtitlePosition'`.
- Add to `AppSettings`:

```ts
  /** Draw the first shot's cues in the big hook style, from its first frame. */
  hookStyleEnabled: boolean
  /** 0-100, where the hook cues are centered. */
  hookPosition: number
```

- Add to `DEFAULTS`:

```ts
  hookStyleEnabled: true,
  hookPosition: SUBTITLE_POSITION_CENTER,
```

Create `src/utils/subtitleHook.ts`:

```ts
import type { AppSettings } from '../hooks/useSettings'
import type { SubtitleCue } from './subtitleCues'
import type { CueVariant } from './subtitleLayout'
import type { SubtitlePosition } from './subtitlePosition'

/**
 * Most viewers decide within the first second or two whether to keep
 * watching, so the first shot gets a "hook" treatment. Which cues get it is
 * decided here, once, on the joined video's timeline, and the preview and
 * both burn paths (per shot, whole video) all go through it so they agree.
 */

export type StyledCue = SubtitleCue & { variant: CueVariant }

export interface HookOptions {
  /** Hook style for the first shot's cues, the first one from 0 s. */
  style: boolean
  /** 0-100, where hook cues are centered. */
  position: SubtitlePosition
}

export type HookSettings = Pick<AppSettings, 'hookStyleEnabled' | 'hookPosition'>

export function hookOptionsOf(settings: HookSettings): HookOptions {
  return { style: settings.hookStyleEnabled, position: settings.hookPosition }
}

// A cue starting where the second shot does is not in the first one.
const EPSILON = 1e-6

/**
 * Mark the cues that start within the first shot (`firstShotDuration`
 * seconds, on the joined timeline) as hook cues, including one that runs on
 * into the next shot, so it doesn't change style midway once cut per shot.
 * The earliest hook cue is moved to start at 0: cues transcribed from the
 * audio begin when the talking does, and the feed's first frame (and the
 * cover) should already show the text.
 */
export function styleCues(
  cues: SubtitleCue[],
  firstShotDuration: number | null,
  hookStyle: boolean,
): StyledCue[] {
  const isHook = (c: SubtitleCue) =>
    hookStyle && firstShotDuration !== null && c.start < firstShotDuration - EPSILON
  let earliest = -1
  cues.forEach((c, i) => {
    if (isHook(c) && (earliest < 0 || c.start < cues[earliest].start)) earliest = i
  })
  return cues.map((c, i) => ({
    ...c,
    start: i === earliest ? 0 : c.start,
    variant: isHook(c) ? 'hook' : 'normal',
  }))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/subtitleHook.test.ts src/hooks/useSettings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/subtitleHook.ts src/utils/subtitleHook.test.ts src/hooks/useSettings.ts src/hooks/useSettings.test.ts
git commit -m "feat: pick out the first shot's cues as hook cues

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Burn paths draw hook cues and emphasis

Both burn paths change together: `burnSubtitles`' signature change would otherwise leave `shotEncoding.ts` broken between commits.

**Files:**
- Modify: `src/utils/subtitleCues.ts` (`cuesForShot` generic)
- Modify: `src/utils/subtitleCues.test.ts`
- Modify: `src/utils/burnSubtitles.ts`
- Modify: `src/utils/burnSubtitles.test.ts`
- Modify: `src/utils/shotEncoding.ts`
- Modify: `src/utils/shotEncoding.test.ts`

**Interfaces:**
- Consumes:
  - `styleCues`, `StyledCue`, `HookOptions` (Task 3)
  - `layoutCue`, `textStylesFor`, `SUBTITLE_BOX_OPACITY`, `CueVariant` (Task 2)
  - `EMPHASIS_COLOR`, `Run` (Task 1)
- Produces:
  - `cuesForShot<T extends SubtitleCue>(cues: T[], shotStart: number, shotDuration: number): T[]`
  - `interface SubtitleLook { position: SubtitlePosition; hook: HookOptions; firstShotDuration: number | null }`
  - `cuePosition(cue: StyledCue, look: SubtitleLook): SubtitlePosition`
  - `renderCueImage(cue: SubtitleCue, variant?: CueVariant): Promise<{ image: Blob; height: number }>`
  - `renderSubtitleOverlays(cues: StyledCue[], look: SubtitleLook): Promise<SubtitleOverlay[]>`
  - `burnSubtitles(videoBlob, cues: SubtitleCue[], look: SubtitleLook, onProgress?, signal?)`
  - `burnShotSubtitles(blob, start, end, cues: StyledCue[], look: SubtitleLook, onProgress?, signal?)`
  - `burnRequest(clip: ShotClip, cues: StyledCue[], look: SubtitleLook): EncodeRequest`
  - `shotBurnRequests(clips, cues: SubtitleCue[], position, hook: HookOptions): EncodeRequest[]`
  - `burnSubtitlesByShot(cache, clips, combinedBlob, cues, position, hook, onProgress?, signal?)`

- [ ] **Step 1: Write the failing tests**

Append to `src/utils/subtitleCues.test.ts`. Add `cuesForShot` to its import if it's missing.

```ts
describe('cuesForShot extra fields', () => {
  it('keeps fields beyond the cue itself, such as its style', () => {
    const cues = [{ id: 'a', start: 0, end: 3, en: 'a', ja: 'あ', variant: 'hook' as const }]
    expect(cuesForShot(cues, 2, 2)).toEqual([{ ...cues[0], start: 0, end: 1 }])
  })
})
```

Replace `src/utils/burnSubtitles.test.ts` entirely with:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildOverlayFilterGraph,
  burnSubtitles,
  cuePosition,
  ffmpegProgressRatio,
  renderCueImage,
  renderSubtitleOverlays,
  type SubtitleLook,
} from './burnSubtitles'
import { CancelledError } from './cancellation'
import { layoutCue, type MeasureText } from './subtitleLayout'
import { subtitleY } from './subtitlePosition'
import type { StyledCue } from './subtitleHook'
import { burnSubtitlesWebCodecs } from './webcodecs/burnSubtitlesWebCodecs'

vi.mock('./webcodecs/support', () => ({
  canUseWebCodecs: vi.fn(async () => true),
  disableWebCodecs: vi.fn(),
}))
vi.mock('./webcodecs/burnSubtitlesWebCodecs', () => ({
  burnSubtitlesWebCodecs: vi.fn(async () => new Blob(['burned'])),
}))

// The canvas stub's text measure: every char is half its font size wide.
const measure: MeasureText = (text, font) => text.length * Number(/(\d+)px/.exec(font)![1]) / 2

/** jsdom has no canvas: record what would be drawn. */
function stubCanvas() {
  const drawn: { text: string; color: string; font: string }[] = []
  const bands: string[] = []
  const ctx = {
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    measureText(text: string) {
      return { width: measure(text, this.font) }
    },
    fillText(text: string) {
      drawn.push({ text, color: String(this.fillStyle), font: this.font })
    },
    beginPath() {},
    roundRect() {},
    fill() {
      bands.push(String(this.fillStyle))
    },
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['png'])))
  return { drawn, bands }
}

const LOOK: SubtitleLook = { position: 72, hook: { style: true, position: 50 }, firstShotDuration: 2 }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildOverlayFilterGraph', () => {
  it('chains one overlay per cue, each reading the previous stage\'s output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph([1500, 1400, 1450])
    expect(filterGraph).toContain('[0:v][sub0]overlay')
    expect(filterGraph).toContain('[v0][sub1]overlay')
    expect(filterGraph).toContain('[v1][sub2]overlay')
    expect(outputLabel).toBe('[v2]')
  })

  it('uses each cue\'s own Y coordinate and centers horizontally', () => {
    const { filterGraph } = buildOverlayFilterGraph([300, 250])
    expect(filterGraph).toContain('[sub0]overlay=x=(W-w)/2:y=300')
    expect(filterGraph).toContain('[sub1]overlay=x=(W-w)/2:y=250')
  })

  it('produces a single overlay stage for one cue', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph([100])
    expect(filterGraph).toBe('[0:v][sub0]overlay=x=(W-w)/2:y=100[v0]')
    expect(outputLabel).toBe('[v0]')
  })

  it('handles zero cues by returning an empty filter graph with the base video as output', () => {
    const { filterGraph, outputLabel } = buildOverlayFilterGraph([])
    expect(filterGraph).toBe('')
    expect(outputLabel).toBe('[0:v]')
  })
})

describe('ffmpegProgressRatio', () => {
  it('is the output time (microseconds) over the video duration', () => {
    expect(ffmpegProgressRatio(45_000_000, 90)).toBe(0.5)
  })

  it('stays within 0–1, including ffmpeg\'s bogus early/late timestamps', () => {
    expect(ffmpegProgressRatio(-1_000, 90)).toBe(0)
    expect(ffmpegProgressRatio(95_000_000, 90)).toBe(1)
    expect(ffmpegProgressRatio(NaN, 90)).toBe(0)
  })

  it('is 0 when the duration is unknown', () => {
    expect(ffmpegProgressRatio(45_000_000, 0)).toBe(0)
  })
})

describe('cuePosition', () => {
  it('centers hook cues at the hook position and the rest at the subtitle position', () => {
    const cue: StyledCue = { id: 'a', start: 0, end: 1, en: 'a', ja: 'あ', variant: 'hook' }
    expect(cuePosition(cue, LOOK)).toBe(50)
    expect(cuePosition({ ...cue, variant: 'normal' }, LOOK)).toBe(72)
  })
})

describe('renderCueImage', () => {
  it('draws an emphasized word in yellow, without its asterisks', async () => {
    const { drawn } = stubCanvas()
    await renderCueImage({ id: 'a', start: 0, end: 1, en: 'I *love* it', ja: 'すき' })
    expect(drawn).toContainEqual(expect.objectContaining({ text: 'love', color: '#FFD60A' }))
    expect(drawn.some(d => d.text.includes('*'))).toBe(false)
  })

  it('draws a hook cue bigger, on a darker band', async () => {
    const { drawn, bands } = stubCanvas()
    await renderCueImage({ id: 'a', start: 0, end: 1, en: 'Hi', ja: 'やあ' }, 'hook')
    expect(bands).toEqual(['rgba(0, 0, 0, 0.8)'])
    expect(drawn[0].font).toBe('bold 100px sans-serif')
  })
})

describe('renderSubtitleOverlays', () => {
  it('places each cue at its variant\'s position, skipping untranslated ones', async () => {
    stubCanvas()
    const hook: StyledCue = { id: 'a', start: 0, end: 1, en: 'Hi', ja: 'やあ', variant: 'hook' }
    const normal: StyledCue = { id: 'b', start: 2, end: 3, en: 'Bye', ja: 'じゃあ', variant: 'normal' }
    const untranslated: StyledCue = { id: 'c', start: 3, end: 4, en: 'Hm', ja: null, variant: 'normal' }
    const overlays = await renderSubtitleOverlays([hook, normal, untranslated], LOOK)
    expect(overlays.map(o => [o.start, o.end, o.y])).toEqual([
      [0, 1, subtitleY(50, 1920, layoutCue(hook, measure, 'hook').height)],
      [2, 3, subtitleY(72, 1920, layoutCue(normal, measure).height)],
    ])
  })
})

describe('burnSubtitles', () => {
  it('rejects a cancelled burn before doing any work (issue #34)', async () => {
    const controller = new AbortController()
    controller.abort()
    const cues = [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: 'やあ' }]
    await expect(
      burnSubtitles(new Blob(['x']), cues, LOOK, undefined, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)
  })

  it('shows the first shot\'s first cue from 0s on the whole joined video', async () => {
    stubCanvas()
    const cues = [
      { id: 'speech-0', start: 0.3, end: 1.5, en: 'one', ja: 'いち' },
      { id: 'speech-1', start: 2.4, end: 3, en: 'two', ja: 'に' },
    ]
    await burnSubtitles(new Blob(['x']), cues, LOOK)
    const overlays = vi.mocked(burnSubtitlesWebCodecs).mock.calls[0][1]
    expect(overlays.map(o => [o.start, o.end])).toEqual([[0, 1.5], [2.4, 3]])
  })

  it('returns the video unchanged when nothing is translated', async () => {
    const video = new Blob(['x'])
    expect(await burnSubtitles(video, [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: null }], LOOK)).toBe(video)
  })
})
```

Replace `src/utils/shotEncoding.test.ts` entirely with the following. It is the old file with:
- `look(...)`/`NO_HOOK` arguments added,
- the burn-call assertions updated to the new arguments,
- three hook tests added.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ShotEncodeCache } from './shotEncodeCache'
import {
  burnRequest,
  burnSubtitlesByShot,
  encodeAll,
  normalizeRequest,
  shotBurnRequests,
  type ShotClip,
} from './shotEncoding'
import { cuesFromShotEntries, type SubtitleCue } from './subtitleCues'
import type { HookOptions, StyledCue } from './subtitleHook'
import * as burnModule from './burnSubtitles'
import type { SubtitleLook } from './burnSubtitles'
import { canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { concatClipsWebCodecs } from './webcodecs/concatClips'
import { trimAndNormalizeShot } from './trimAndNormalizeShot'
import { CancelledError } from './cancellation'

vi.mock('./burnSubtitles')
vi.mock('./trimAndNormalizeShot', () => ({
  trimAndNormalizeShot: vi.fn(async () => new Blob(['normalized'])),
}))
vi.mock('./webcodecs/support', () => ({
  canUseWebCodecs: vi.fn(async () => true),
  disableWebCodecs: vi.fn(),
}))
vi.mock('./webcodecs/concatClips', () => ({
  concatClipsWebCodecs: vi.fn(async (blobs: Blob[]) => new Blob(blobs)),
}))

const JOINED = new Blob(['joined'])
const NO_HOOK: HookOptions = { style: false, position: 50 }
const HOOK: HookOptions = { style: true, position: 50 }

function look(position: number, extra: Partial<SubtitleLook> = {}): SubtitleLook {
  return { position, hook: NO_HOOK, firstShotDuration: null, ...extra }
}

function clip(shotId: string, start: number, end: number, blob = new Blob([shotId])): ShotClip {
  return { shotId, blob, start, end }
}

function translate(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map(c => ({ ...c, ja: `${c.en}-ja` }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(canUseWebCodecs).mockResolvedValue(true)
  vi.mocked(burnModule.burnShotSubtitles).mockImplementation(async blob => new Blob([blob, '+subs']))
  vi.mocked(burnModule.burnSubtitles).mockResolvedValue(new Blob(['whole-video-burn']))
})

describe('burnRequest', () => {
  const shot = clip('s1', 0.5, 2.5)
  const cue: StyledCue = { id: 'shot-0', start: 0, end: 2, en: 'Hi', ja: 'やあ', variant: 'normal' }

  it('is the normalize request when the shot has nothing to burn', () => {
    expect(burnRequest(shot, [], look(50)).key).toBe(normalizeRequest(shot).key)
    expect(burnRequest(shot, [{ ...cue, ja: null }], look(50)).key).toBe(normalizeRequest(shot).key)
  })

  it('changes key with the text or the position, and keeps it otherwise', () => {
    const base = burnRequest(shot, [cue], look(50)).key
    expect(burnRequest(shot, [{ ...cue }], look(50)).key).toBe(base)
    expect(burnRequest(shot, [{ ...cue, ja: 'こんにちは' }], look(50)).key).not.toBe(base)
    expect(burnRequest(shot, [{ ...cue, en: 'Hello' }], look(50)).key).not.toBe(base)
    expect(burnRequest(shot, [cue], look(72)).key).not.toBe(base)
  })

  it('changes key with the cue style, and with the hook position only for a hook cue', () => {
    const hookCue: StyledCue = { ...cue, variant: 'hook' }
    const at50 = look(50, { hook: { style: true, position: 50 } })
    const at30 = look(50, { hook: { style: true, position: 30 } })
    expect(burnRequest(shot, [hookCue], at50).key).not.toBe(burnRequest(shot, [cue], at50).key)
    expect(burnRequest(shot, [hookCue], at30).key).not.toBe(burnRequest(shot, [hookCue], at50).key)
    expect(burnRequest(shot, [cue], at30).key).toBe(burnRequest(shot, [cue], at50).key)
  })

  it('shares a slot per shot so a newer look replaces the older one', () => {
    expect(burnRequest(shot, [cue], look(50)).slot).toBe(burnRequest(shot, [cue], look(72)).slot)
    expect(burnRequest(shot, [cue], look(50)).slot).not.toBe(normalizeRequest(shot).slot)
  })
})

describe('shotBurnRequests', () => {
  it('gives each shot its own cue, in the shot\'s timeline', async () => {
    const clips = [clip('a', 1, 3), clip('b', 0, 1.5)]
    const cues = translate(cuesFromShotEntries([
      { text: 'first', duration: 2 },
      { text: 'second', duration: 1.5 },
    ]))
    const cache = new ShotEncodeCache()

    await Promise.all(shotBurnRequests(clips, cues, 50, NO_HOOK).map(r => cache.get(r)))

    const calls = vi.mocked(burnModule.burnShotSubtitles).mock.calls
    expect(calls.map(([blob, start, end, shotCues, shotLook]) => [blob, start, end, shotCues, shotLook])).toEqual([
      [clips[0].blob, 1, 3, [expect.objectContaining({ en: 'first', start: 0, end: 2, variant: 'normal' })],
        { position: 50, hook: NO_HOOK, firstShotDuration: 2 }],
      [clips[1].blob, 0, 1.5, [expect.objectContaining({ en: 'second', start: 0, end: 1.5, variant: 'normal' })],
        { position: 50, hook: NO_HOOK, firstShotDuration: null }],
    ])
  })

  it('styles every cue starting in the first shot as a hook cue, the first from its first frame', async () => {
    const clips = [clip('a', 0, 2), clip('b', 0, 2)]
    // Transcribed cues: the first shot split in two, the first starting late,
    // and the second running on into the next shot.
    const cues = translate([
      { id: 'speech-0', start: 0.3, end: 1, en: 'one', ja: null },
      { id: 'speech-1', start: 1.2, end: 2.6, en: 'two', ja: null },
      { id: 'speech-2', start: 2.8, end: 3.8, en: 'three', ja: null },
    ])
    const cache = new ShotEncodeCache()

    await Promise.all(shotBurnRequests(clips, cues, 72, HOOK).map(r => cache.get(r)))

    const [first, second] = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[3])
    expect(first.map(c => [c.en, c.start, c.variant])).toEqual([['one', 0, 'hook'], ['two', 1.2, 'hook']])
    expect(second.map(c => [c.en, c.start, c.variant])).toEqual([
      ['two', 0, 'hook'],
      ['three', expect.closeTo(0.8), 'normal'],
    ])
  })
})

describe('burnSubtitlesByShot', () => {
  const clips = [clip('a', 0, 2), clip('b', 0, 1)]
  const cues = translate(cuesFromShotEntries([
    { text: 'first', duration: 2 },
    { text: 'second', duration: 1 },
  ]))
  const fallbackLook = { position: 50, hook: NO_HOOK, firstShotDuration: 2 }

  it('joins the per-shot burns by packet copy', async () => {
    const out = await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(2)
    expect(concatClipsWebCodecs).toHaveBeenCalledTimes(1)
    expect(burnModule.burnSubtitles).not.toHaveBeenCalled()
    const burned = await Promise.all(vi.mocked(burnModule.burnShotSubtitles).mock.results.map(r => r.value))
    expect(concatClipsWebCodecs).toHaveBeenCalledWith(burned, undefined)
    expect(out).toBe(await vi.mocked(concatClipsWebCodecs).mock.results[0].value)
  })

  it('only re-burns the shot whose subtitle changed', async () => {
    const cache = new ShotEncodeCache()
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, NO_HOOK)
    const edited = cues.map((c, i) => (i === 1 ? { ...c, ja: '直した' } : c))
    await burnSubtitlesByShot(cache, clips, JOINED, edited, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(3)
    expect(vi.mocked(burnModule.burnShotSubtitles).mock.calls[2][0]).toBe(clips[1].blob)
  })

  it('only re-burns the first shot when the hook style is switched', async () => {
    const cache = new ShotEncodeCache()
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, HOOK)
    await burnSubtitlesByShot(cache, clips, JOINED, cues, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(3)
    expect(vi.mocked(burnModule.burnShotSubtitles).mock.calls[2][0]).toBe(clips[0].blob)
  })

  it('reuses the normalized clip for a shot without subtitles', async () => {
    const partial = cues.slice(0, 1)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, partial, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(1)
    expect(trimAndNormalizeShot).toHaveBeenCalledTimes(1)
    expect(vi.mocked(trimAndNormalizeShot).mock.calls[0][0]).toBe(clips[1].blob)
  })

  it('returns the joined video untouched when nothing is translated', async () => {
    const out = await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cuesFromShotEntries([
      { text: 'first', duration: 2 },
    ]), 50, NO_HOOK)
    expect(out).toBe(JOINED)
    expect(burnModule.burnShotSubtitles).not.toHaveBeenCalled()
  })

  it('burns the whole joined video when WebCodecs is unavailable, with the first shot\'s length', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK)

    expect(burnModule.burnShotSubtitles).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, fallbackLook, undefined, undefined)
  })

  it('disables WebCodecs and burns the whole video when a per-shot burn fails', async () => {
    const err = new Error('encoder died')
    vi.mocked(burnModule.burnShotSubtitles).mockRejectedValueOnce(err)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK)

    expect(disableWebCodecs).toHaveBeenCalledWith(err)
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, fallbackLook, undefined, undefined)
  })

  // Issue #33: the fallback re-encodes the whole video and can take minutes
  // on a phone; without progress the button sat at "0%" the whole time.
  it('reports the whole-video fallback\'s progress', async () => {
    vi.mocked(burnModule.burnShotSubtitles).mockRejectedValueOnce(new Error('encoder died'))
    vi.mocked(burnModule.burnSubtitles).mockImplementation(async (_blob, _cues, _look, onProgress) => {
      onProgress?.(0.37)
      return new Blob(['whole-video-burn'])
    })
    const onProgress = vi.fn()
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK, onProgress)

    expect(onProgress).toHaveBeenLastCalledWith(0.37)
  })

  it('burns the whole video, keeping WebCodecs on, when the burned shots can\'t be packet-joined', async () => {
    vi.mocked(concatClipsWebCodecs).mockRejectedValueOnce(new Error('different parameters'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK)
    warn.mockRestore()

    expect(disableWebCodecs).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, fallbackLook, undefined, undefined)
  })
})

describe('cancelling (issue #34)', () => {
  const clips = [clip('a', 0, 2), clip('b', 0, 1)]
  const cues = translate(cuesFromShotEntries([
    { text: 'first', duration: 2 },
    { text: 'second', duration: 1 },
  ]))

  it('encodeAll cancels the cache, so a hung encode stops blocking it', async () => {
    const cache = new ShotEncodeCache()
    const controller = new AbortController()
    const all = encodeAll(cache, [{ slot: 's1', key: 'k1', run: () => new Promise<Blob>(() => {}) }], undefined, controller.signal)

    controller.abort()

    await expect(all).rejects.toBeInstanceOf(CancelledError)
    await expect(cache.get({ slot: 's2', key: 'k2', run: async () => new Blob(['ok']) })).resolves.toBeInstanceOf(Blob)
  })

  it('encodeAll rejects at once for an already-cancelled signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = vi.fn(async () => new Blob(['x']))

    await expect(encodeAll(new ShotEncodeCache(), [{ slot: 's', key: 'k', run }], undefined, controller.signal))
      .rejects.toBeInstanceOf(CancelledError)
    expect(run).not.toHaveBeenCalled()
  })

  it('burnSubtitlesByShot neither disables WebCodecs nor burns the whole video when cancelled', async () => {
    const controller = new AbortController()
    vi.mocked(burnModule.burnShotSubtitles).mockImplementationOnce(() => {
      controller.abort()
      return new Promise<Blob>(() => {})
    })

    await expect(
      burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK, undefined, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)

    expect(disableWebCodecs).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).not.toHaveBeenCalled()
  })

  it('burnSubtitlesByShot passes the signal to each shot\'s burn', async () => {
    const controller = new AbortController()
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, NO_HOOK, undefined, controller.signal)

    const signals = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[6])
    expect(signals).toHaveLength(2)
    expect(signals.every(s => s instanceof AbortSignal)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/subtitleCues.test.ts src/utils/burnSubtitles.test.ts src/utils/shotEncoding.test.ts`
Expected: FAIL (`cuePosition` is not exported, cues have no `variant`, and the overlays aren't styled).

- [ ] **Step 3: Implement `cuesForShot` as generic**

In `src/utils/subtitleCues.ts`, change only the signature line of `cuesForShot`. The body already spreads `...cue`, so extra fields survive.

```ts
export function cuesForShot<T extends SubtitleCue>(cues: T[], shotStart: number, shotDuration: number): T[] {
  const shotEnd = shotStart + shotDuration
  const out: T[] = []
```

- [ ] **Step 4: Implement the burn rendering**

In `src/utils/burnSubtitles.ts`:

1. Replace the `subtitleLayout` import block and add the new imports:

```ts
import { styleCues, type HookOptions, type StyledCue } from './subtitleHook'
import { EMPHASIS_COLOR, type Run } from './subtitleEmphasis'
import {
  SUBTITLE_BLOCK_GAP,
  SUBTITLE_BOX_MARGIN_X,
  SUBTITLE_BOX_OPACITY,
  SUBTITLE_BOX_PADDING_Y,
  SUBTITLE_BOX_RADIUS,
  SUBTITLE_REFERENCE_WIDTH,
  TextBlockLayout,
  fontFor,
  layoutCue,
  textStylesFor,
  type CueVariant,
} from './subtitleLayout'
```

2. Below `buildOverlayFilterGraph`, add the look type, `cuePosition` and the run drawer:

```ts
/** How subtitles look beyond the cues themselves. */
export interface SubtitleLook {
  /** 0-100, where normal cues are centered. */
  position: SubtitlePosition
  hook: HookOptions
  /**
   * The first shot's length, when this video starts with it (the whole
   * joined video, or the first shot's own clip); null for any other shot.
   */
  firstShotDuration: number | null
}

/** Where a cue is centered: hook cues have a position of their own. */
export function cuePosition(cue: StyledCue, look: SubtitleLook): SubtitlePosition {
  return cue.variant === 'hook' ? look.hook.position : look.position
}

/** Draw one line's runs centered on `centerX`, emphasized ones in yellow. */
function fillRuns(ctx: CanvasRenderingContext2D, runs: Run[], centerX: number, y: number, color: string) {
  const widths = runs.map(run => ctx.measureText(run.text).width)
  let x = centerX - widths.reduce((sum, w) => sum + w, 0) / 2
  runs.forEach((run, i) => {
    ctx.fillStyle = run.emphasized ? EMPHASIS_COLOR : color
    ctx.fillText(run.text, x, y)
    x += widths[i]
  })
}
```

3. Replace `renderCueImage` (keep its doc comment, adding a line about the variant and emphasis):

```ts
/**
 * Render one cue's bilingual subtitle (English bold/larger above, Japanese
 * smaller below, on a semi-transparent rounded background) as a transparent
 * PNG as wide as the video and exactly as tall as its box. Text is wrapped
 * onto balanced lines (see subtitleLayout) rather than shrunk until it fits
 * one line, which left long cues unreadably small and still overflowing.
 * A hook cue is bigger on a darker band; `*emphasized*` words are yellow.
 */
export async function renderCueImage(
  cue: SubtitleCue,
  variant: CueVariant = 'normal',
): Promise<{ image: Blob; height: number }> {
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (!measureCtx) throw new Error('Canvas 2D context unavailable')
  const layout = layoutCue(cue, (text, font) => {
    measureCtx.font = font
    return measureCtx.measureText(text).width
  }, variant)

  const width = SUBTITLE_REFERENCE_WIDTH
  const height = layout.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  ctx.fillStyle = `rgba(0, 0, 0, ${SUBTITLE_BOX_OPACITY[variant]})`
  ctx.beginPath()
  ctx.roundRect(SUBTITLE_BOX_MARGIN_X, 0, width - SUBTITLE_BOX_MARGIN_X * 2, height, SUBTITLE_BOX_RADIUS)
  ctx.fill()

  // Runs are laid side by side from the left, centered as a whole line.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let top = SUBTITLE_BOX_PADDING_Y
  const drawBlock = (block: TextBlockLayout, font: string, color: string) => {
    ctx.font = font
    for (const runs of block.runs) {
      fillRuns(ctx, runs, width / 2, top + block.lineHeightPx / 2, color)
      top += block.lineHeightPx
    }
  }
  const styles = textStylesFor(variant)
  drawBlock(layout.en, fontFor(styles.en, layout.en.fontPx), '#ffffff')
  if (layout.ja) {
    top += SUBTITLE_BLOCK_GAP
    drawBlock(layout.ja, fontFor(styles.ja, layout.ja.fontPx), 'rgba(255, 255, 255, 0.85)')
  }

  const image = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to render subtitle image'))
    }, 'image/png')
  })
  return { image, height }
}
```

4. Replace `renderSubtitleOverlays`:

```ts
/**
 * Render each cue that has a `ja` translation to its PNG and place it:
 * shown over [start, start + duration), centered on its position (the
 * hook position for hook cues) but kept fully on screen. Cues without a
 * translation aren't burned in.
 */
export async function renderSubtitleOverlays(cues: StyledCue[], look: SubtitleLook): Promise<SubtitleOverlay[]> {
  const overlays: SubtitleOverlay[] = []
  for (const cue of cues) {
    if (cue.ja === null) continue
    const { image, height } = await renderCueImage(cue, cue.variant)
    overlays.push({
      start: cue.start,
      end: cue.start + cueDuration(cue),
      image,
      y: Math.min(Math.max(subtitleY(cuePosition(cue, look), VIDEO_HEIGHT, height), 0), VIDEO_HEIGHT - height),
    })
  }
  return overlays
}
```

5. In `burnSubtitles`, change the signature and the first lines. The rest (WebCodecs, then the ffmpeg fallback using `translated`) is unchanged.

```ts
export async function burnSubtitles(
  videoBlob: Blob,
  cues: SubtitleCue[],
  look: SubtitleLook,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  // The whole joined video starts with the first shot, so hook cues are
  // those starting within its length, as in the per-shot path.
  const translated = styleCues(cues, look.firstShotDuration, look.hook.style).filter(c => c.ja !== null)
  if (translated.length === 0) {
    // Nothing to burn in — return the video unchanged.
    return videoBlob
  }
  const overlays = await renderSubtitleOverlays(translated, look)
```

Also add one sentence to `burnSubtitles`' doc comment: "Cues are styled here (see styleCues), so pass them as edited."

6. Replace `burnShotSubtitles`:

```ts
/**
 * Trim and normalize one shot with its subtitles composited in the same
 * hardware encode (see normalizeShotWebCodecs). `cues` are already styled
 * on the joined timeline and moved into the trimmed shot's own (see
 * shotBurnRequests). WebCodecs only — throws when it's unavailable, so the
 * caller can fall back to burnSubtitles on the joined video.
 */
export async function burnShotSubtitles(
  blob: Blob,
  start: number,
  end: number,
  cues: StyledCue[],
  look: SubtitleLook,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  if (!(await canUseWebCodecs())) throw new Error('WebCodecs unavailable for per-shot burn-in')
  const overlays = await renderSubtitleOverlays(cues, look)
  return normalizeShotWebCodecs(blob, start, end, onProgress, overlays, signal)
}
```

7. Remove the now-unused imports `EN_STYLE`, `JA_STYLE` (`textStylesFor` replaces them). Keep the `SubtitlePosition` import, since `SubtitleLook` uses it.

- [ ] **Step 5: Implement the shot encoding**

In `src/utils/shotEncoding.ts`:

1. Replace the imports of `burnSubtitles` and `subtitleCues`, and add the hook import:

```ts
import { burnShotSubtitles, burnSubtitles, type SubtitleLook } from './burnSubtitles'
import { cuesForShot, type SubtitleCue } from './subtitleCues'
import { styleCues, type HookOptions, type StyledCue } from './subtitleHook'
```

2. Replace `burnRequest`, `shotBurnRequests`, and add `firstShotDurationOf`:

```ts
/** How long the joined video's first shot is, or null with no shots. */
function firstShotDurationOf(clips: ShotClip[]): number | null {
  return clips.length > 0 ? clips[0].end - clips[0].start : null
}

/**
 * The shot trimmed and normalized with `cues` (styled, in the shot's own
 * timeline) burned in by the same encode. A shot with nothing to burn is
 * just its normalized clip, so it's shared with the combine step's cache
 * entry. The key holds everything that changes the pixels, so switching
 * the hook style re-encodes only the shots that have hook cues.
 */
export function burnRequest(clip: ShotClip, cues: StyledCue[], look: SubtitleLook): EncodeRequest {
  const translated = cues.filter(c => c.ja !== null)
  if (translated.length === 0) return normalizeRequest(clip)
  const hasHookCue = translated.some(c => c.variant === 'hook')
  const placement = JSON.stringify([look.position, hasHookCue ? look.hook.position : null])
  const text = JSON.stringify(translated.map(c => [c.start.toFixed(3), c.end.toFixed(3), c.en, c.ja, c.variant]))
  return {
    slot: `burn:${clip.shotId}`,
    key: `burn|${clipKey(clip)}|${placement}|${text}`,
    run: (onProgress, signal) =>
      burnShotSubtitles(clip.blob, clip.start, clip.end, translated, look, onProgress, signal),
  }
}

/**
 * One burn request per shot, each given the cues that fall within it.
 * Shots start where the previous one ended — the same running offset
 * cuesFromShotEntries times the cues by. Cues are styled on the joined
 * timeline first, so one running on past the first shot stays a hook cue.
 */
export function shotBurnRequests(
  clips: ShotClip[],
  cues: SubtitleCue[],
  position: SubtitlePosition,
  hook: HookOptions,
): EncodeRequest[] {
  const styled = styleCues(cues, firstShotDurationOf(clips), hook.style)
  let offset = 0
  return clips.map((clip, i) => {
    const duration = clip.end - clip.start
    const look: SubtitleLook = { position, hook, firstShotDuration: i === 0 ? duration : null }
    const request = burnRequest(clip, cuesForShot(styled, offset, duration), look)
    offset += duration
    return request
  })
}
```

3. In `burnSubtitlesByShot`:
- Add the `hook: HookOptions` parameter after `position`.
- Pass `hook` to `shotBurnRequests`.
- Change the final fallback call:

```ts
export async function burnSubtitlesByShot(
  cache: ShotEncodeCache,
  clips: ShotClip[],
  combinedBlob: Blob,
  cues: SubtitleCue[],
  position: SubtitlePosition,
  hook: HookOptions,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
```

```ts
      burned = await encodeAll(cache, shotBurnRequests(clips, cues, position, hook), onProgress, signal)
```

```ts
  return burnSubtitles(combinedBlob, cues, { position, hook, firstShotDuration: firstShotDurationOf(clips) }, onProgress, signal)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/utils/subtitleCues.test.ts src/utils/burnSubtitles.test.ts src/utils/shotEncoding.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/subtitleCues.ts src/utils/subtitleCues.test.ts src/utils/burnSubtitles.ts src/utils/burnSubtitles.test.ts src/utils/shotEncoding.ts src/utils/shotEncoding.test.ts
git commit -m "feat: burn the first shot's cues in hook style, with emphasis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`FinalizePage.tsx` and `SubtitleWorkflow.test.tsx` won't type-check until Tasks 6–7; vitest still runs them.)

---

### Task 5: Preview matches the burn

**Files:**
- Modify: `src/components/SubtitleOverlayPreview.tsx`
- Modify: `src/components/SubtitleOverlayPreview.module.css`
- Modify: `src/components/SubtitleOverlayPreview.test.tsx`

**Interfaces:**
- Consumes:
  - `styleCues`, `HookOptions` (Task 3)
  - `layoutCue(…, variant)`, `SUBTITLE_BOX_OPACITY`, `TextBlockLayout.runs` (Task 2)
  - `EMPHASIS_COLOR` (Task 1)
- Produces: `SubtitleOverlayPreview` props `{ cues, position, currentTime, hook?: HookOptions, firstShotDuration?: number | null }`. The box carries `data-variant="normal" | "hook"`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/SubtitleOverlayPreview.test.tsx`, inside the `describe`:

```tsx
  const HOOK = { style: true, position: 50 }
  const cqw = (px: number) => `${(px / 1080) * 100}cqw`

  it('shows the first shot\'s cue in hook style at the hook position', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={72} currentTime={1} hook={HOOK} firstShotDuration={2} />)
    const box = screen.getByTestId('subtitle-overlay-box')
    expect(box).toHaveAttribute('data-variant', 'hook')
    expect(box.style.top).toBe('50%')
    expect(box.style.backgroundColor).toBe('rgba(0, 0, 0, 0.8)')
    expect(box.querySelector('p')!.style.fontSize).toBe(cqw(100))
  })

  it('shows later cues normally', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={72} currentTime={3} hook={HOOK} firstShotDuration={2} />)
    const box = screen.getByTestId('subtitle-overlay-box')
    expect(box).toHaveAttribute('data-variant', 'normal')
    expect(box.style.top).toBe('72%')
    expect(box.style.backgroundColor).toBe('rgba(0, 0, 0, 0.55)')
  })

  it('shows a transcribed first cue from 0s with the hook style, as timed without it', () => {
    const late: SubtitleCue[] = [{ id: 's0', start: 0.3, end: 1.2, en: 'So', ja: 'で' }]
    const { rerender, container } = render(
      <SubtitleOverlayPreview cues={late} position={72} currentTime={0.1} hook={HOOK} firstShotDuration={2} />,
    )
    expect(screen.getByText('So')).toBeInTheDocument()
    rerender(<SubtitleOverlayPreview cues={late} position={72} currentTime={0.1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('paints an *emphasized* word yellow, without the asterisks', () => {
    const cues: SubtitleCue[] = [{ id: 'c1', start: 0, end: 2, en: 'I *love* it', ja: 'すき' }]
    render(<SubtitleOverlayPreview cues={cues} position={50} currentTime={1} />)
    expect(screen.getByText('love')).toHaveStyle({ color: '#FFD60A' })
    expect(screen.queryByText(/\*/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/SubtitleOverlayPreview.test.tsx`
Expected: FAIL (no `data-variant`, and the asterisks are shown).

- [ ] **Step 3: Implement**

Replace `src/components/SubtitleOverlayPreview.tsx` with:

```tsx
import { CSSProperties, Fragment, useMemo } from 'react'
import { SubtitleCue } from '../utils/subtitleCues'
import { SubtitlePosition } from '../utils/subtitlePosition'
import { styleCues, type HookOptions } from '../utils/subtitleHook'
import { EMPHASIS_COLOR } from '../utils/subtitleEmphasis'
import {
  SUBTITLE_BLOCK_GAP,
  SUBTITLE_BOX_MARGIN_X,
  SUBTITLE_BOX_OPACITY,
  SUBTITLE_BOX_PADDING_X,
  SUBTITLE_BOX_PADDING_Y,
  SUBTITLE_BOX_RADIUS,
  SUBTITLE_REFERENCE_WIDTH,
  TextBlockLayout,
  createCanvasMeasure,
  layoutCue,
} from '../utils/subtitleLayout'
import styles from './SubtitleOverlayPreview.module.css'

interface SubtitleOverlayPreviewProps {
  cues: SubtitleCue[]
  position: SubtitlePosition
  currentTime: number
  /** The first shot's hook treatment; without it every cue is a normal one. */
  hook?: HookOptions
  /** The first shot's length in seconds, which decides the hook cues. */
  firstShotDuration?: number | null
}

/** Reference-video px → a length relative to the preview container's width. */
const cqw = (px: number) => `${(px / SUBTITLE_REFERENCE_WIDTH) * 100}cqw`

function blockStyle(block: TextBlockLayout): CSSProperties {
  return { fontSize: cqw(block.fontPx), lineHeight: cqw(block.lineHeightPx) }
}

/** A block's lines, with `*emphasized*` runs in yellow as burned in. */
function BlockLines({ block }: { block: TextBlockLayout }) {
  return (
    <>
      {block.runs.map((runs, i) => (
        <span key={i} className={styles.line}>
          {runs.map((run, j) =>
            run.emphasized
              ? <span key={j} style={{ color: EMPHASIS_COLOR }}>{run.text}</span>
              : <Fragment key={j}>{run.text}</Fragment>,
          )}
        </span>
      ))}
    </>
  )
}

/**
 * Cheap DOM/CSS approximation of the real burned-in subtitle box, positioned
 * at the same vertical percent the real burn-in will use and laid out with
 * the same line breaks and sizes (scaled to the preview's width). Cues go
 * through the same styleCues as the burn, so the first shot's hook style
 * and its 0 s start show here too. Lets the user see where the subtitle
 * will land without re-running the expensive burn-in on every change.
 */
export default function SubtitleOverlayPreview({
  cues,
  position,
  currentTime,
  hook,
  firstShotDuration = null,
}: SubtitleOverlayPreviewProps) {
  const measure = useMemo(() => createCanvasMeasure(), [])
  const hookStyle = hook?.style ?? false
  const styled = useMemo(
    () => styleCues(cues, firstShotDuration, hookStyle),
    [cues, firstShotDuration, hookStyle],
  )
  const cue = styled.find(c => currentTime >= c.start && currentTime < c.end)
  const layout = useMemo(() => (cue ? layoutCue(cue, measure, cue.variant) : null), [cue, measure])
  if (!cue || !layout) return null

  const wrapperStyle: CSSProperties = {
    top: `${cue.variant === 'hook' && hook ? hook.position : position}%`,
    width: cqw(SUBTITLE_REFERENCE_WIDTH - SUBTITLE_BOX_MARGIN_X * 2),
    padding: `${cqw(SUBTITLE_BOX_PADDING_Y)} ${cqw(SUBTITLE_BOX_PADDING_X)}`,
    borderRadius: cqw(SUBTITLE_BOX_RADIUS),
    backgroundColor: `rgba(0, 0, 0, ${SUBTITLE_BOX_OPACITY[cue.variant]})`,
  }

  return (
    <div className={styles.wrapper} style={wrapperStyle} data-testid="subtitle-overlay-box" data-variant={cue.variant}>
      <p className={styles.en} style={blockStyle(layout.en)}>
        <BlockLines block={layout.en} />
      </p>
      {layout.ja && (
        <p className={styles.ja} style={{ ...blockStyle(layout.ja), marginTop: cqw(SUBTITLE_BLOCK_GAP) }}>
          <BlockLines block={layout.ja} />
        </p>
      )}
    </div>
  )
}
```

In `src/components/SubtitleOverlayPreview.module.css`, delete the line `background: rgba(0, 0, 0, 0.55);` from `.wrapper` (the band is now set inline per variant).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/SubtitleOverlayPreview.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS (Settings' samples still render normal boxes).

- [ ] **Step 5: Commit**

```bash
git add src/components/SubtitleOverlayPreview.tsx src/components/SubtitleOverlayPreview.module.css src/components/SubtitleOverlayPreview.test.tsx
git commit -m "feat: preview the hook style and emphasis as they burn in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hook controls in the subtitle step

**Files:**
- Modify: `src/components/SubtitleWorkflow.tsx`
- Modify: `src/components/SubtitleWorkflow.module.css`
- Modify: `src/components/SubtitleWorkflow.test.tsx`

**Interfaces:**
- Consumes: `HookSettings`, `hookOptionsOf` (Task 3), and `SubtitleOverlayPreview`'s `hook`/`firstShotDuration` (Task 5).
- Produces:
  - New required props on `SubtitleWorkflow`: `hookSettings: HookSettings` and `onHookSettingsChange: (patch: Partial<HookSettings>) => void`.
  - The normal position presets sit in `role="group" aria-label="字幕の位置"`, the hook ones in `role="group" aria-label="フック字幕の位置"`.
  - The checkbox is labelled `フック字幕`, and the hook slider `フック字幕の上下位置`.

- [ ] **Step 1: Update the existing tests for the new props and the second preset row**

In `src/components/SubtitleWorkflow.test.tsx`:

1. Imports. Change `@testing-library/react` to also import `within`, and add:

```ts
import { hookOptionsOf, type HookSettings } from '../utils/subtitleHook'
```

2. Replace `ControlledSubtitleWorkflow` with:

```tsx
const DEFAULT_HOOK_SETTINGS: HookSettings = { hookStyleEnabled: true, hookPosition: 50 }

// SubtitleWorkflow is a controlled component (state/onStateChange lifted up
// to FinalizePage, so subtitle work survives the component unmounting on
// wizard back-navigation; hook settings live in useSettings there). This
// wrapper mirrors how FinalizePage drives it.
function ControlledSubtitleWorkflow({
  combinedBlob,
  shotCueInputs,
  onBurned,
  transcribe,
  onHookSettingsChange,
}: {
  combinedBlob: Blob
  shotCueInputs: ShotCueInput[]
  onBurned: (blob: Blob) => void
  transcribe?: (blob: Blob, onProgress: (p: WhisperProgress) => void, signal: AbortSignal) => Promise<SubtitleCue[]>
  onHookSettingsChange?: (patch: Partial<HookSettings>) => void
}) {
  const [state, setState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
  const [hookSettings, setHookSettings] = useState<HookSettings>(DEFAULT_HOOK_SETTINGS)
  return (
    <SubtitleWorkflow
      combinedBlob={combinedBlob}
      shotCueInputs={shotCueInputs}
      state={state}
      onStateChange={setState}
      hookSettings={hookSettings}
      onHookSettingsChange={patch => {
        setHookSettings(prev => ({ ...prev, ...patch }))
        onHookSettingsChange?.(patch)
      }}
      burn={(cues, position) =>
        burnModule.burnSubtitles(combinedBlob, cues, {
          position,
          hook: hookOptionsOf(hookSettings),
          firstShotDuration: shotCueInputs[0]?.duration ?? null,
        })
      }
      onBurned={onBurned}
      transcribe={transcribe}
    />
  )
}

/** The normal subtitle's 上部/中央/下部, as opposed to the hook's. */
const positionGroup = () => within(screen.getByRole('group', { name: '字幕の位置' }))
```

3. Edit the existing assertions:
   - `expect(screen.getByText('下部')).toHaveAttribute('aria-pressed', 'true')` (first test) → `expect(positionGroup().getByText('下部')).toHaveAttribute('aria-pressed', 'true')`
   - The first test's burn assertion becomes:

```ts
    expect(burnModule.burnSubtitles).toHaveBeenCalledWith(
      BLOB,
      expect.anything(),
      expect.objectContaining({ position: 72.2917 }),
    )
```

   - `expect(burnModule.burnSubtitles).toHaveBeenCalledWith(BLOB, expect.anything(), 30)` → `expect(burnModule.burnSubtitles).toHaveBeenCalledWith(BLOB, expect.anything(), expect.objectContaining({ position: 30 }))`
   - `expect(screen.getByText('下部')).toBeInTheDocument()` (retry test) → `expect(positionGroup().getByText('下部')).toBeInTheDocument()`
   - `fireEvent.click(screen.getByText('上部'))` (cancel test) → `fireEvent.click(positionGroup().getByText('上部'))`
   - `expect(screen.getByText('上部')).toHaveAttribute('aria-pressed', 'true')` (cancel test) → `expect(positionGroup().getByText('上部')).toHaveAttribute('aria-pressed', 'true')`
   - Every other `<SubtitleWorkflow …>` rendered directly in this file (e.g. `StuckWorkflow` or other local wrappers — search for `<SubtitleWorkflow`) gets the two new props: `hookSettings={DEFAULT_HOOK_SETTINGS} onHookSettingsChange={() => {}}`.

- [ ] **Step 2: Write the failing tests**

Append to `src/components/SubtitleWorkflow.test.tsx`:

```tsx
describe('SubtitleWorkflow hook controls', () => {
  async function renderTranslated(onHookSettingsChange = vi.fn()) {
    seedBurnMock()
    render(
      <ControlledSubtitleWorkflow
        combinedBlob={BLOB}
        shotCueInputs={SHOT_CUE_INPUTS}
        onBurned={vi.fn()}
        onHookSettingsChange={onHookSettingsChange}
      />,
    )
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    return onHookSettingsChange
  }

  const hookGroup = () => within(screen.getByRole('group', { name: 'フック字幕の位置' }))

  it('previews the first shot in hook style at the hook position', async () => {
    await renderTranslated()
    const box = screen.getByTestId('subtitle-overlay-box')
    expect(box).toHaveAttribute('data-variant', 'hook')
    expect(box.style.top).toBe('50%')
    expect(hookGroup().getByText('中央')).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches the hook style off, reporting it to be saved', async () => {
    const onChange = await renderTranslated()
    fireEvent.click(screen.getByLabelText('フック字幕'))
    expect(onChange).toHaveBeenCalledWith({ hookStyleEnabled: false })
    expect(screen.getByTestId('subtitle-overlay-box')).toHaveAttribute('data-variant', 'normal')
    for (const button of hookGroup().getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('moves the hook subtitle with its own presets and slider', async () => {
    const onChange = await renderTranslated()
    fireEvent.click(hookGroup().getByText('上部'))
    expect(onChange).toHaveBeenCalledWith({ hookPosition: 13.75 })
    expect(screen.getByTestId('subtitle-overlay-box').style.top).toBe('13.75%')

    fireEvent.click(screen.getByText('細かく調整'))
    fireEvent.change(screen.getByLabelText('フック字幕の上下位置'), { target: { value: '40' } })
    expect(onChange).toHaveBeenLastCalledWith({ hookPosition: 40 })
  })

  it('burns with the hook settings and the first shot\'s length', async () => {
    await renderTranslated()
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => expect(burnModule.burnSubtitles).toHaveBeenCalled())
    expect(burnModule.burnSubtitles).toHaveBeenLastCalledWith(
      BLOB,
      expect.anything(),
      expect.objectContaining({ hook: { style: true, position: 50 }, firstShotDuration: 2 }),
    )
  })

  it('explains *emphasis* under the English subtitles', async () => {
    await renderTranslated()
    expect(screen.getByText(/で囲んだ語は黄色/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx`
Expected: FAIL (no `字幕の位置` group, and no hook controls).

- [ ] **Step 4: Implement**

In `src/components/SubtitleWorkflow.tsx`:

1. Add the import:

```ts
import { hookOptionsOf, type HookSettings } from '../utils/subtitleHook'
```

2. Add to `SubtitleWorkflowProps` (after `onStateChange`):

```ts
  /** The first shot's hook settings, kept in useSettings by the parent. */
  hookSettings: HookSettings
  onHookSettingsChange: (patch: Partial<HookSettings>) => void
```

3. Destructure them in the component's parameter list (`hookSettings, onHookSettingsChange,` after `onStateChange,`). Below `allTranslated`, add:

```ts
  const hook = hookOptionsOf(hookSettings)
  // The first clip of the 結合: hook cues are the ones starting within it.
  const firstShotDuration = shotCueInputs[0]?.duration ?? null
```

4. Under `<SubtitleEditor … />` in the English section, add:

```tsx
            <p className={styles.hint}>*で囲んだ語は黄色で強調されます（例: I *love* it）</p>
```

5. Pass the hook to the preview:

```tsx
                <SubtitleOverlayPreview
                  cues={cues}
                  position={position}
                  currentTime={previewTime}
                  hook={hook}
                  firstShotDuration={firstShotDuration}
                />
```

6. Give the existing preset row a group role. Change `<div className={styles.positionRow}>` (the one rendering `SUBTITLE_POSITION_PRESETS` under 字幕の位置) to:

```tsx
              <div className={styles.positionRow} role="group" aria-label="字幕の位置">
```

7. Right after that preset row (before the 細かく調整 button), add the hook block:

```tsx
              <p className={styles.sectionTitle}>最初のショット（フック）</p>
              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={hookSettings.hookStyleEnabled}
                  onChange={e => onHookSettingsChange({ hookStyleEnabled: e.target.checked })}
                />
                フック字幕
              </label>
              <p className={styles.hint}>最初のショットの字幕を大きく濃い帯で、1フレーム目から表示します</p>
              <div className={styles.positionRow} role="group" aria-label="フック字幕の位置">
                {SUBTITLE_POSITION_PRESETS.map(p => (
                  <button
                    key={p.label}
                    className={`${styles.positionBtn} ${hookSettings.hookPosition === p.value ? styles.positionBtnActive : ''}`}
                    aria-pressed={hookSettings.hookPosition === p.value}
                    disabled={!hookSettings.hookStyleEnabled}
                    onClick={() => onHookSettingsChange({ hookPosition: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
```

8. Inside the `{fineTune && (…)}` block, after the existing `字幕の上下位置` slider, add a second label + slider (still within the same `.fineTuneRow` div):

```tsx
                  <label htmlFor="hook-position-slider">フック字幕の上下位置</label>
                  <input
                    id="hook-position-slider"
                    aria-label="フック字幕の上下位置"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={hookSettings.hookPosition}
                    disabled={!hookSettings.hookStyleEnabled}
                    onChange={e => onHookSettingsChange({ hookPosition: Number(e.target.value) })}
                  />
```

In `src/components/SubtitleWorkflow.module.css`, add:

```css
.toggleRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
}

.positionBtn:disabled {
  opacity: 0.4;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/SubtitleWorkflow.tsx src/components/SubtitleWorkflow.module.css src/components/SubtitleWorkflow.test.tsx
git commit -m "feat: switch and place the hook subtitle from the subtitle step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the hook through FinalizePage

**Files:**
- Modify: `src/pages/FinalizePage.tsx`
- Modify: `src/pages/FinalizePage.test.tsx`

**Interfaces:**
- Consumes:
  - `hookOptionsOf` (Task 3)
  - `shotBurnRequests(…, hook)` and `burnSubtitlesByShot(…, hook, …)` (Task 4)
  - `SubtitleWorkflow`'s `hookSettings`/`onHookSettingsChange` (Task 6)

- [ ] **Step 1: Update the existing tests for the second preset row**

In `src/pages/FinalizePage.test.tsx`:
- Add `within` to the `@testing-library/react` import.
- In `describe('FinalizePage subtitle step: picks up where it was left')`, change both `screen.getByRole('button', { name: '上部' })` to `within(screen.getByRole('group', { name: '字幕の位置' })).getByRole('button', { name: '上部' })`.

- [ ] **Step 2: Write the failing test**

Append to `src/pages/FinalizePage.test.tsx`:

```tsx
describe('FinalizePage subtitle step: hook on the first shot', () => {
  it('burns the first shot in hook style, and remembers switching it off', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(burnModule.burnShotSubtitles).mockResolvedValue(new Blob(['burned-shot'], { type: 'video/mp4' }))
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    fireEvent.click(await screen.findByText('次へ'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))

    await waitFor(() => expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(1), { timeout: 2000 })
    const [, , , cues, look] = vi.mocked(burnModule.burnShotSubtitles).mock.calls[0]
    expect(cues).toEqual([expect.objectContaining({ variant: 'hook', start: 0 })])
    expect(look).toMatchObject({ hook: { style: true, position: 50 }, firstShotDuration: 5 })

    fireEvent.click(screen.getByLabelText('フック字幕'))
    await waitFor(() => expect(burnModule.burnShotSubtitles).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(vi.mocked(burnModule.burnShotSubtitles).mock.calls[1][3]).toEqual([
      expect.objectContaining({ variant: 'normal' }),
    ])
    expect(JSON.parse(localStorage.getItem('teleprompter_settings')!).hookStyleEnabled).toBe(false)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/pages/FinalizePage.test.tsx`
Expected: FAIL (`SubtitleWorkflow` gets no `hookSettings`, so it crashes reading `hookStyleEnabled`).

- [ ] **Step 4: Implement**

In `src/pages/FinalizePage.tsx`:

1. Add the import:

```ts
import { hookOptionsOf } from '../utils/subtitleHook'
```

2. Change `const [settings] = useSettings()` to:

```ts
  // One settings instance for the page: the subtitle step changes the hook
  // settings through it, so the burn below always sees the current ones.
  const [settings, updateSettings] = useSettings()
  const { hookStyleEnabled, hookPosition } = settings
```

3. Update the background-burn effect:

```ts
  const { stage: subtitleStage, cues: subtitleCues, position: subtitlePosition } = subtitleState
  useEffect(() => {
    if (step !== 'subtitle' || subtitleStage !== 'reviewing' || combinedClips.length === 0) return
    if (subtitleCues.length === 0 || !subtitleCues.every(c => c.ja !== null && c.ja.trim() !== '')) return
    const timer = setTimeout(() => {
      const cache = getEncodeCache()
      const hook = hookOptionsOf({ hookStyleEnabled, hookPosition })
      for (const request of shotBurnRequests(combinedClips, subtitleCues, subtitlePosition, hook)) {
        cache.prefetch(request)
      }
    }, BACKGROUND_ENCODE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [step, subtitleStage, subtitleCues, subtitlePosition, combinedClips, hookStyleEnabled, hookPosition])
```

4. In the `<SubtitleWorkflow …>` element:
- Add after `onStateChange={setSubtitleState}`:

```tsx
                hookSettings={{ hookStyleEnabled, hookPosition }}
                onHookSettingsChange={updateSettings}
```

- Change the `burn` prop:

```tsx
                burn={(cues, position, onProgress, signal) =>
                  burnSubtitlesByShot(
                    getEncodeCache(),
                    combinedClips,
                    combinedBlob,
                    cues,
                    position,
                    hookOptionsOf({ hookStyleEnabled, hookPosition }),
                    onProgress,
                    signal,
                  )
                }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/pages/FinalizePage.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/pages/FinalizePage.tsx src/pages/FinalizePage.test.tsx
git commit -m "feat: burn the hook style from the finalize page, keeping its settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verify and open PR 1

**Files:** none (fix-ups only if something fails)

- [ ] **Step 1: Full test suite, type-check, lint, build**

Run: `npx vitest run && npx tsc -b && npm run lint && npm run build`
Expected: all tests pass; tsc, lint and build finish without errors.

- [ ] **Step 2: Look at it in the browser**

Add a temporary entry to the **main checkout's** `.claude/launch.json` (`preview_start` reads that one, not the worktree's):

```json
{ "name": "hook-pr1", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", ".claude/worktrees/hook-first-shot", "run", "dev", "--", "--port", "5174"], "port": 5174 }
```

Then:
1. Start the preview with `preview_start { name: "hook-pr1" }`.
2. Open 設定 and check that the subtitle samples still look the same as before (normal band).
3. If a script with recorded takes exists in this browser profile, go through 仕上げる → 字幕 and check:
   - the first cue shows big, centered, on the darker band, from 0:00;
   - `*word*` shows yellow;
   - turning フック字幕 off reverts it.
4. Remove the temporary launch entry afterwards.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/hook-first-shot
gh pr create --title "feat: hook style for the first shot's subtitles, keyword emphasis" --body "$(cat <<'EOF'
## Summary
- The first shot's cues are drawn in a big hook style (EN 100→72px, JA 75→57px, band 0.8) at their own position (default center), in the preview and both burn paths.
- The first hook cue shows from 0.0s, so the feed's first frame already carries the text.
- `*word*` paints a word #FFD60A in any subtitle; markers are stripped before wrapping.
- フック字幕 on/off and its position are set in the subtitle step and saved in settings.

Spec: docs/superpowers/specs/2026-10-08-hook-first-shot-design.md (items 1–3; items 4–6 follow in PR 2).

## Test plan
- [ ] `npx vitest run`, `npx tsc -b`, `npm run lint`, `npm run build`
- [ ] On iPhone (Vercel preview, relaunch the home-screen app first): first shot's subtitle big and centered from 0:00; later shots normal; `*word*` yellow; toggling フック字幕 off re-burns only the first shot

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then bind the PR with the ccd_pr tools (`get_status` / `bind_pr`). Merge with `gh pr merge --merge` once checks pass and the user approves (the repo has no auto-merge).
