import { Shot } from '../types'

// How alike an edited line must be to an old one to still count as that
// shot (Dice coefficient over character bigrams). A typo fix or an added
// word clears this easily; an unrelated inserted line doesn't.
const MIN_SIMILARITY = 0.5

function bigrams(text: string): string[] {
  const padded = ` ${text} `
  const result: string[] = []
  for (let i = 0; i < padded.length - 1; i++) result.push(padded.slice(i, i + 2))
  return result
}

export function textSimilarity(a: string, b: string): number {
  const aGrams = bigrams(a)
  const bGrams = bigrams(b)
  const counts = new Map<string, number>()
  for (const g of aGrams) counts.set(g, (counts.get(g) ?? 0) + 1)
  let shared = 0
  for (const g of bGrams) {
    const n = counts.get(g) ?? 0
    if (n > 0) {
      shared++
      counts.set(g, n - 1)
    }
  }
  return (2 * shared) / (aGrams.length + bGrams.length)
}

/**
 * Build the shot list for re-split script text while keeping existing shots'
 * ids (and per-shot trim overrides) wherever possible. Recorded videos in
 * IndexedDB are keyed by shot id, so minting fresh ids on every edit would
 * orphan every take already recorded for the script.
 *
 * A line whose text is unchanged keeps its shot even if it moved. Remaining
 * lines are then paired with remaining old shots by text similarity, so a
 * lightly edited line (a typo fix) keeps its shot while an inserted line gets
 * a new one — never another line's recording.
 */
export function reconcileShots(oldShots: Shot[], texts: string[], generateId: () => string): Shot[] {
  const used = new Set<string>()
  const result: (Shot | null)[] = texts.map(text => {
    const match = oldShots.find(s => !used.has(s.id) && s.text === text)
    if (!match) return null
    used.add(match.id)
    return match
  })

  const candidates: { newIndex: number; old: Shot; score: number; distance: number }[] = []
  result.forEach((shot, newIndex) => {
    if (shot) return
    oldShots.forEach((old, oldIndex) => {
      if (used.has(old.id)) return
      const score = textSimilarity(old.text, texts[newIndex])
      if (score >= MIN_SIMILARITY) {
        candidates.push({ newIndex, old, score, distance: Math.abs(oldIndex - newIndex) })
      }
    })
  })
  candidates.sort((a, b) => b.score - a.score || a.distance - b.distance)
  for (const { newIndex, old } of candidates) {
    if (result[newIndex] || used.has(old.id)) continue
    used.add(old.id)
    result[newIndex] = { ...old, text: texts[newIndex] }
  }

  return result.map((shot, i) => shot ?? { id: generateId(), text: texts[i] })
}
