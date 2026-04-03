export interface SplitOptions {
  period: boolean        // 句点（。．）
  exclamation: boolean   // 感嘆・疑問符（！？!?）
  englishPeriod: boolean // 英語ピリオド（.）
  newline: boolean       // 改行
}

export const DEFAULT_SPLIT_OPTIONS: SplitOptions = {
  period: true,
  exclamation: true,
  englishPeriod: true,
  newline: true,
}

export function splitShots(text: string, options: SplitOptions = DEFAULT_SPLIT_OPTIONS): string[] {
  if (!text.trim()) return []

  const parts: string[] = []
  if (options.period) parts.push('(?<=[。．])\\s*')
  if (options.exclamation) parts.push('(?<=[!?！？])\\s*')
  if (options.englishPeriod) parts.push('(?<=[.])\\s*')
  if (options.newline) parts.push('\\n+')

  if (parts.length === 0) return [text.trim()].filter(Boolean)

  const regex = new RegExp(parts.join('|'))
  return text.split(regex).map(s => s.trim()).filter(s => s.length > 0)
}
