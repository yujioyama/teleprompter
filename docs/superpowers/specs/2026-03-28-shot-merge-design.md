# Shot Merge Feature — Design Spec

**Date:** 2026-03-28
**Status:** Approved

---

## Overview

On the ShotEdit page (`/scripts/:id/shots`), users can merge two shot cards into one by dragging one card on top of another. Dropping in the center zone of a target card triggers a merge; dropping near the top or bottom edge continues the existing reorder behavior. Merged text always follows top-to-bottom reading order. An undo toast appears for 5 seconds after each merge.

---

## User Interaction

1. User long-presses the drag handle (⠿) on a shot card and drags it.
2. While dragging over another card:
   - **Top 30% of target** → reorder highlight (existing behavior)
   - **Middle 40% of target** → merge highlight: purple glow border + "🔗 合体" overlay label on the target card
   - **Bottom 30% of target** → reorder highlight (existing behavior)
3. User releases:
   - **Over merge zone** → shots merge, undo toast appears
   - **Over reorder zone** → shots reorder (existing behavior)
   - **Anywhere else** → no change

---

## Text Merge Logic

The merged text always follows the visual top-to-bottom order at the time of the drag (i.e., original array indices before the drag started).

| Dragged card position | Target card position | Result text |
|---|---|---|
| Above target (lower index) | Below dragged | `dragged.text + " " + target.text` |
| Below target (higher index) | Above dragged | `target.text + " " + dragged.text` |

- Separator: single half-width space `" "`
- The dragged card is removed from the list
- The target card's text is updated to the merged text
- The target card stays at its current position
- Non-adjacent merges (e.g., card 1 onto card 5) are allowed — no adjacency restriction
- `mergeShots()` calls `updateScript` immediately so the merge persists even if the user navigates away without tapping "撮影開始"

---

## Drag State & Collision Detection

dnd-kit's `closestCenter` remains in place for `DndContext`. Merge intent is tracked separately via `onDragOver`:

```ts
const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
```

**`onDragOver` handler:**
1. If `event.over` is null → `setMergeTargetId(null)`, return
2. Get the target card's bounding rect from `event.over.rect` (a `ClientRect` provided by dnd-kit)
3. Get the dragged item's current center Y from `event.active.rect.current.translated?.top + height/2`
4. Compute `relativeY = (centerY - over.rect.top) / over.rect.height`
5. If `0.30 < relativeY < 0.70` → `setMergeTargetId(event.over.id as string)`
6. Otherwise → `setMergeTargetId(null)`

**Important:** `shots` state is never mutated during a drag. `mergeTargetId` is purely UI state.

**`handleDragEnd` handler:**
```
if mergeTargetId is not null and mergeTargetId !== active.id:
  → call mergeShots(active.id, mergeTargetId)
else:
  → existing arrayMove reorder logic (over.id used as before)
setMergeTargetId(null)
```

This avoids synthetic droppable IDs and works entirely within dnd-kit's existing droppable registry.

---

## Visual Feedback

When `mergeTargetId === shot.id`, `ShotCard` receives `isMergeTarget={true}`. The card applies `.mergeTarget` styles:
- `box-shadow: 0 0 0 2px var(--accent), 0 0 12px var(--accent)`
- Dashed border replacing solid border
- A centered `"🔗 合体"` label absolutely positioned over the card body (pointer-events: none)

---

## Undo Mechanism

State added to `ShotEditPage`:

```ts
const [lastMergeSnapshot, setLastMergeSnapshot] = useState<Shot[] | null>(null)
const [undoVisible, setUndoVisible] = useState(false)
const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

**Helper to clear active timer:**
```ts
function clearUndoTimer() {
  if (undoTimerRef.current !== null) {
    clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
  }
}
```

**On merge:**
1. `clearUndoTimer()` — cancel any previous undo timer
2. Save current `shots` to `lastMergeSnapshot`
3. Apply merge to `shots`, call `updateScript` immediately
4. Set `undoVisible = true`
5. Start new timer: after 5 s, set `undoVisible = false` and `lastMergeSnapshot = null`, store ref in `undoTimerRef`

**On undo:**
1. `clearUndoTimer()`
2. Restore `shots` from `lastMergeSnapshot`, call `updateScript` to persist restored state
3. Set `undoVisible = false`, `lastMergeSnapshot = null`

**Undo is cancelled (toast dismissed immediately, timer cleared) when:**
- Another merge occurs (new snapshot and new timer replace old)
- User adds or deletes a shot → call `clearUndoTimer()` + `setUndoVisible(false)`

**Toast UI** — fixed position above the footer:
```
┌─────────────────────────────────┐
│  ショットを合体しました  [元に戻す]  │
└─────────────────────────────────┘
```

---

## Files to Change

| File | Change |
|---|---|
| `src/pages/ShotEditPage.tsx` | `onDragOver` handler, `mergeTargetId` state, `mergeShots()`, undo state + `undoTimerRef`, toast UI, immediate `updateScript` on merge |
| `src/pages/ShotEditPage.module.css` | `.undoToast`, `.undoBtn` styles |
| `src/components/ShotCard.tsx` | Accept `isMergeTarget?: boolean` prop |
| `src/components/ShotCard.module.css` | `.mergeTarget` styles (glow, dashed border, overlay label) |

---

## Out of Scope

- Merging more than 2 shots at once
- Multi-level undo (only the most recent merge is undoable)
- Merging shots across different scripts
