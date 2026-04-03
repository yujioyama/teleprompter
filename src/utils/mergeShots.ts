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
