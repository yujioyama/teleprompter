# Shot Merge Feature — Design Spec

**Date:** 2026-03-28
**Status:** Approved

---

## Overview

On the ShotEdit page (`/scripts/:id/shots`), users can merge two adjacent shot cards into one by dragging one card on top of another. Dropping in the center zone of a target card triggers a merge; dropping near the top or bottom edge continues the existing reorder behavior. Merged text always follows top-to-bottom reading order. An undo toast appears for 5 seconds after each merge.

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

---

## Collision Detection

Replace `closestCenter` with a custom function `mergeCenterOrSort`:

```
For each droppable card that the dragged card overlaps:
  - Compute overlap center Y relative to the target card's rect
  - If 30% < relativeY < 70%  → collision id = "merge::{targetId}"
  - Otherwise                 → collision id = targetId  (normal sort)

Return the closest match by standard center-distance.
```

`handleDragEnd` checks `over.id`:
- Starts with `"merge::"` → extract target id and call `mergeShots(activeId, targetId)`
- Otherwise → existing `arrayMove` reorder logic

---

## Visual Feedback

During drag, `DragOverEvent` fires on every position change. A new piece of state `mergeTargetId: string | null` tracks which card (if any) is in merge-zone position.

When `mergeTargetId` is set, the target `ShotCard` receives a `isMergeTarget` prop that applies:
- `box-shadow: 0 0 0 2px var(--accent), 0 0 12px var(--accent)` (purple glow)
- Dashed border replacing solid border
- A centered `"🔗 合体"` label absolutely positioned over the card body

---

## Undo Mechanism

State added to `ShotEditPage`:

```ts
const [lastMergeSnapshot, setLastMergeSnapshot] = useState<Shot[] | null>(null)
const [undoVisible, setUndoVisible] = useState(false)
```

**On merge:**
1. Save current `shots` to `lastMergeSnapshot`
2. Apply merge to `shots`
3. Set `undoVisible = true`
4. Start a 5-second timer; on expiry set `undoVisible = false` and `lastMergeSnapshot = null`

**On undo:**
1. Restore `shots` from `lastMergeSnapshot`
2. Set `undoVisible = false`, `lastMergeSnapshot = null`
3. Cancel the timer

**Undo is cancelled (toast dismissed immediately) when:**
- Another merge occurs (new snapshot replaces old)
- User adds or deletes a shot
- User navigates away

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
| `src/pages/ShotEditPage.tsx` | Custom collision detector, `onDragOver` handler, `mergeShots()`, undo state, toast UI |
| `src/pages/ShotEditPage.module.css` | `.undoToast`, `.undoBtn` styles |
| `src/components/ShotCard.tsx` | Accept `isMergeTarget?: boolean` prop |
| `src/components/ShotCard.module.css` | `.mergeTarget` styles (glow, dashed border, overlay label) |

---

## Out of Scope

- Merging more than 2 shots at once
- Multi-level undo (only the most recent merge is undoable)
- Merging shots across different scripts
