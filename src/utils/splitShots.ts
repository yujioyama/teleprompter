export function splitShots(text: string): string[] {
  if (!text.trim()) return []

  // Split after sentence-ending punctuation or on newlines
  const segments = text.split(/(?<=[。．.!?！？])\s*|\n+/)

  return segments
    .map(s => s.trim())
    .filter(s => s.length > 0)
}
