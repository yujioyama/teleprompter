# Shot Merge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users merge two shot cards into one by dragging one on top of another, with an undo toast.

**Architecture:** A pure utility function computes the merged text. `ShotEditPage` tracks `mergeTargetId` via `onDragOver` using dnd-kit's `over.rect`; on drag end, if `mergeTargetId` is set it calls `mergeShots()` instead of reordering. `ShotCard` renders a merge-target highlight when `isMergeTarget={true}`. Undo is managed with a `useRef` timer and snapshot state.

**Tech Stack:** React 18, TypeScript, @dnd-kit/core + @dnd-kit/sortable, Vitest (test runner: `npm test` inside `teleprompter-app/`), CSS Modules

**Spec:** `docs/superpowers/specs/2026-03-28-shot-merge-design.md`

---

## Chunk 1: Pure merge utility

### Task 1: `computeMergedText` utility + tests

**Files:**
- Create: `teleprompter-app/src/utils/mergeShots.ts`
- Create: `teleprompter-app/src/utils/mergeShots.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `teleprompter-app/src/utils/mergeShots.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeMergedText } from './mergeShots'

describe('computeMergedText', () => {
  it('puts dragged text first when dragged was above target (lower index)', () => {
    expect(computeMergedText(0, 2, 'Hello', 'World')).toBe('Hello World')
  })

  it('puts target text first when dragged was below target (higher index)', () => {
    expect(computeMergedText(3, 1, 'suffix', 'prefix')).toBe('prefix suffix')
  })

  it('uses a single half-width space as separator', () => {
    expect(computeMergedText(0, 1, 'foo', 'bar')).toBe('foo bar')
  })

  it('works when texts contain Japanese — separator is half-width space U+0020', () => {
    const result = computeMergedText(0, 1, '東京に来ました。', '今日は晴れです。')
    expect(result).toBe('東京に来ました。 今日は晴れです。')
    expect(result.charAt(8)).toBe('\u0020') // confirm separator is ASCII space
  })

  it('works when dragged is one position above target', () => {
    expect(computeMergedText(1, 2, 'A', 'B')).toBe('A B')
  })

  it('falls back to target-first when indices are equal (defensive)', () => {
    // Same-card drops are prevented upstream, but the function should not crash
    expect(computeMergedText(2, 2, 'X', 'Y')).toBe('Y X')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd teleprompter-app && npm test -- mergeShots
```

Expected: FAIL — `computeMergedText` not found.

- [ ] **Step 3: Implement `computeMergedText`**

Create `teleprompter-app/src/utils/mergeShots.ts`:

```ts
/**
 * Compute the merged text of two shots.
 * The shot that was visually higher (lower original index) always comes first.
 * Separator: single half-width space.
 */
export function computeMergedText(
  draggedOriginalIndex: number,
  targetOriginalIndex: number,
  draggedText: string,
  targetText: string,
): string {
  if (draggedOriginalIndex < targetOriginalIndex) {
    return `${draggedText} ${targetText}`
  }
  return `${targetText} ${draggedText}`
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd teleprompter-app && npm test -- mergeShots
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add teleprompter-app/src/utils/mergeShots.ts teleprompter-app/src/utils/mergeShots.test.ts
git commit -m "feat: add computeMergedText utility with tests"
```

---

## Chunk 2: ShotCard merge-target highlight

### Task 2: `isMergeTarget` prop + CSS

**Files:**
- Modify: `teleprompter-app/src/components/ShotCard.tsx`
- Modify: `teleprompter-app/src/components/ShotCard.module.css`

- [ ] **Step 1: Add `.mergeTarget` CSS**

In `teleprompter-app/src/components/ShotCard.module.css`, add after `.card`:

```css
.mergeTarget {
  border-style: dashed;
  box-shadow: 0 0 0 2px var(--accent), 0 0 12px var(--accent);
  position: relative;
}

.mergeLabel {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--accent);
  background: rgba(10, 10, 15, 0.55);
  border-radius: 12px;
  pointer-events: none;
  user-select: none;
}
```

- [ ] **Step 2: Add `isMergeTarget` prop to `ShotCard`**

In `teleprompter-app/src/components/ShotCard.tsx`, update the `Props` interface and component:

```tsx
interface Props {
  shot: Shot
  index: number
  onUpdate: (id: string, text: string) => void
  onDelete: (id: string) => void
  isMergeTarget?: boolean   // ← add this
}

export default function ShotCard({ shot, index, onUpdate, onDelete, isMergeTarget }: Props) {
```

In the return JSX, change the root `<div>` className line and add the merge label:

```tsx
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.card}${isMergeTarget ? ` ${styles.mergeTarget}` : ''}`}
    >
      {isMergeTarget && (
        <div className={styles.mergeLabel}>🔗 合体</div>
      )}
      {/* rest of JSX unchanged */}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd teleprompter-app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add teleprompter-app/src/components/ShotCard.tsx teleprompter-app/src/components/ShotCard.module.css
git commit -m "feat: add isMergeTarget highlight to ShotCard"
```

---

## Chunk 3: ShotEditPage wiring (drag-over, merge, undo)

### Task 3: Add all imports and state

**Files:**
- Modify: `teleprompter-app/src/pages/ShotEditPage.tsx`
- Modify: `teleprompter-app/src/pages/ShotEditPage.module.css`

- [ ] **Step 1: Update imports in `ShotEditPage.tsx`**

Replace the existing `@dnd-kit/core` import block:

```tsx
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,   // ← add
} from '@dnd-kit/core'
```

Also add `useRef` to the React import:

```tsx
import { useState, useRef } from 'react'
```

Add `computeMergedText` import after existing imports:

```tsx
import { computeMergedText } from '../utils/mergeShots'
```

- [ ] **Step 2: Add merge and undo state inside the component**

After the existing `const [shots, setShots] = useState<Shot[]>(...)` line, add:

```tsx
const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
const [lastMergeSnapshot, setLastMergeSnapshot] = useState<Shot[] | null>(null)
const [undoVisible, setUndoVisible] = useState(false)
const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

- [ ] **Step 3: Add `clearUndoTimer` helper and `handleDragOver`**

After the existing `sensors` declaration and before the early-return guard, add:

```tsx
function clearUndoTimer() {
  if (undoTimerRef.current !== null) {
    clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
  }
}

function handleDragOver(event: DragOverEvent) {
  const { active, over } = event
  if (!over || over.id === active.id) {
    setMergeTargetId(null)
    return
  }
  const translated = active.rect.current.translated
  if (!translated) {
    setMergeTargetId(null)
    return
  }
  const dragCenterY = translated.top + translated.height / 2
  const targetRect = over.rect
  const relativeY = (dragCenterY - targetRect.top) / targetRect.height
  if (relativeY > 0.3 && relativeY < 0.7) {
    setMergeTargetId(over.id as string)
  } else {
    setMergeTargetId(null)
  }
}
```

- [ ] **Step 4: Add `mergeShots` function and update `handleDragEnd`**

Add `mergeShots` after `handleDragOver`:

```tsx
function mergeShots(activeId: string, targetId: string) {
  const activeIndex = shots.findIndex(s => s.id === activeId)
  const targetIndex = shots.findIndex(s => s.id === targetId)
  if (activeIndex === -1 || targetIndex === -1) return

  const mergedText = computeMergedText(
    activeIndex,
    targetIndex,
    shots[activeIndex].text,
    shots[targetIndex].text,
  )
  const next = shots
    .filter(s => s.id !== activeId)
    .map(s => s.id === targetId ? { ...s, text: mergedText } : s)

  setLastMergeSnapshot([...shots])
  setShots(next)
  updateScript(safeScript.id, { shots: next })

  clearUndoTimer()
  setUndoVisible(true)
  undoTimerRef.current = setTimeout(() => {
    setUndoVisible(false)
    setLastMergeSnapshot(null)
    undoTimerRef.current = null
  }, 5000)
}
```

Replace the existing `handleDragEnd`:

```tsx
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event
  const currentMergeTarget = mergeTargetId
  setMergeTargetId(null)

  if (!over || active.id === over.id) return

  if (currentMergeTarget && currentMergeTarget === over.id) {
    mergeShots(active.id as string, currentMergeTarget)
    return
  }

  setShots(prev => {
    const oldIndex = prev.findIndex(s => s.id === active.id)
    const newIndex = prev.findIndex(s => s.id === over.id)
    return arrayMove(prev, oldIndex, newIndex)
  })
}
```

- [ ] **Step 5: Add undo handler and update `handleAdd` / `handleDelete`**

Add undo handler after `handleSave`:

```tsx
function handleUndo() {
  if (!lastMergeSnapshot) return
  clearUndoTimer()
  setShots(lastMergeSnapshot)
  updateScript(safeScript.id, { shots: lastMergeSnapshot })
  setUndoVisible(false)
  setLastMergeSnapshot(null)
}
```

Update `handleAdd` and `handleDelete` to dismiss the undo toast:

```tsx
function handleAdd() {
  clearUndoTimer()
  setUndoVisible(false)
  setShots(prev => [...prev, { id: generateId(), text: '新しいショット' }])
}

function handleDelete(shotId: string) {
  clearUndoTimer()
  setUndoVisible(false)
  setShots(prev => prev.filter(s => s.id !== shotId))
}
```

- [ ] **Step 6: Update JSX — wire `onDragOver`, `isMergeTarget`, and undo toast**

In the JSX, update `DndContext` to add `onDragOver`:

```tsx
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
>
```

Update `ShotCard` to pass `isMergeTarget`:

```tsx
<ShotCard
  key={shot.id}
  shot={shot}
  index={i}
  onUpdate={handleUpdate}
  onDelete={handleDelete}
  isMergeTarget={mergeTargetId === shot.id}
/>
```

Add undo toast just before the closing `</div>` of `.footer`:

```tsx
      <div className={styles.footer}>
        <button className={styles.recordBtn} onClick={handleSave}>
          🎬 撮影開始
        </button>
      </div>

      {undoVisible && (
        <div className={styles.undoToast}>
          <span>ショットを合体しました</span>
          <button className={styles.undoBtn} onClick={handleUndo}>
            元に戻す
          </button>
        </div>
      )}
```

- [ ] **Step 7: Add toast CSS to `ShotEditPage.module.css`**

Append at the bottom of `teleprompter-app/src/pages/ShotEditPage.module.css`:

```css
.undoToast {
  position: fixed;
  bottom: calc(max(16px, env(safe-area-inset-bottom)) + 80px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 0.9rem;
  color: var(--text);
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 100;
}

.undoBtn {
  background: var(--accent);
  color: #fff;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 0.85rem;
  font-weight: 600;
}
```

- [ ] **Step 8: Verify TypeScript compiles and tests pass**

```bash
cd teleprompter-app && npx tsc --noEmit && npm test
```

Expected: no TypeScript errors, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add teleprompter-app/src/pages/ShotEditPage.tsx teleprompter-app/src/pages/ShotEditPage.module.css
git commit -m "feat: drag-to-merge shots with 5s undo toast"
```

- [ ] **Step 10: Push**

```bash
git push origin main
```

---

## Manual Verification Checklist (iPhone / Xcode)

After deployment, verify on device:

- [ ] Drag a card slowly over another → center zone shows purple glow + 🔗 合体 label
- [ ] Drag near top/bottom edge of a card → normal reorder highlight (no glow)
- [ ] Drop on center zone → cards merge, text order is top→bottom, undo toast appears
- [ ] Drop on edge → reorder as before, no toast
- [ ] Tap "元に戻す" within 5 s → shots restored to pre-merge state
- [ ] Wait 5 s without tapping undo → toast disappears, merge is permanent
- [ ] Add or delete a shot while toast is visible → toast disappears immediately
- [ ] Merge card 1 onto card 5 (non-adjacent) → works correctly
- [ ] Drag card 5 onto card 1 → merged text is card 1 text first
