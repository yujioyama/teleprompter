import { describe, it, expect } from 'vitest'
import { splitShots } from './splitShots'

describe('splitShots', () => {
  it('splits on Japanese period（。）', () => {
    const result = splitShots('今日はAIの話をします。次に機械学習を説明します。')
    expect(result).toEqual([
      '今日はAIの話をします。',
      '次に機械学習を説明します。',
    ])
  })

  it('splits on newlines', () => {
    const result = splitShots('1行目\n2行目\n3行目')
    expect(result).toEqual(['1行目', '2行目', '3行目'])
  })

  it('splits on English period', () => {
    const result = splitShots('Hello world. This is a test.')
    expect(result).toEqual(['Hello world.', 'This is a test.'])
  })

  it('splits on exclamation and question marks', () => {
    const result = splitShots('すごい！本当に？やった！')
    expect(result).toEqual(['すごい！', '本当に？', 'やった！'])
  })

  it('removes empty segments', () => {
    const result = splitShots('  \n\nテスト。\n\n  ')
    expect(result).toEqual(['テスト。'])
  })

  it('handles mixed delimiters', () => {
    const result = splitShots('導入です。\n次のポイント！最後にまとめます。')
    expect(result).toEqual(['導入です。', '次のポイント！', '最後にまとめます。'])
  })

  it('returns single item for text with no delimiters', () => {
    const result = splitShots('区切りのないテキスト')
    expect(result).toEqual(['区切りのないテキスト'])
  })

  it('returns empty array for empty input', () => {
    const result = splitShots('')
    expect(result).toEqual([])
  })
})
