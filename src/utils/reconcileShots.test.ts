import { describe, it, expect, beforeEach } from 'vitest'
import { reconcileShots, textSimilarity } from './reconcileShots'
import { Shot } from '../types'

let seq = 0
const newId = () => `new-${++seq}`

describe('reconcileShots', () => {
  beforeEach(() => {
    seq = 0
  })

  const old: Shot[] = [
    { id: 'a', text: '今日は新商品を紹介します', trimEnabled: false },
    { id: 'b', text: 'まずはデザインから見ていきましょう', trimPaddingStart: 1.2 },
    { id: 'c', text: 'ご視聴ありがとうございました' },
  ]
  const [A, B, C] = old.map(s => s.text)

  it('keeps every shot (id and per-shot settings) when the text is unchanged', () => {
    expect(reconcileShots(old, [A, B, C], newId)).toEqual(old)
  })

  it('keeps ids of shots that only moved', () => {
    const result = reconcileShots(old, [C, A, B], newId)
    expect(result.map(s => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('gives an inserted line a new id without shifting the others', () => {
    const result = reconcileShots(old, [A, '価格は税込み三千円です', B, C], newId)
    expect(result.map(s => s.id)).toEqual(['a', 'new-1', 'b', 'c'])
    expect(result[1]).toEqual({ id: 'new-1', text: '価格は税込み三千円です' })
  })

  it('keeps the id and settings of a lightly edited line (e.g. a typo fix)', () => {
    const edited = 'まずはデザインから見ていきましょう！'
    const result = reconcileShots(old, [A, edited, C], newId)
    expect(result[1]).toEqual({ id: 'b', text: edited, trimPaddingStart: 1.2 })
  })

  it('does not hand an old recording to an unrelated inserted line when another line was also edited', () => {
    const edited = 'まずはデザインを見ていきましょう'
    const result = reconcileShots(old, [A, '価格は税込み三千円です', edited, C], newId)
    expect(result.map(s => s.id)).toEqual(['a', 'new-1', 'b', 'c'])
  })

  it('gives a completely rewritten line a new id', () => {
    const result = reconcileShots(old, [A, '次に機能を説明します', C], newId)
    expect(result.map(s => s.id)).toEqual(['a', 'new-1', 'c'])
  })

  it('drops removed lines', () => {
    const result = reconcileShots(old, [A, C], newId)
    expect(result.map(s => s.id)).toEqual(['a', 'c'])
  })

  it('matches duplicate texts one-to-one', () => {
    const dup: Shot[] = [{ id: 'x1', text: 'はい' }, { id: 'x2', text: 'はい' }]
    const result = reconcileShots(dup, ['はい', 'はい', 'はい'], newId)
    expect(result.map(s => s.id)).toEqual(['x1', 'x2', 'new-1'])
  })
})

describe('textSimilarity', () => {
  it('is 1 for identical text and 0 for text with nothing in common', () => {
    expect(textSimilarity('こんにちは', 'こんにちは')).toBe(1)
    expect(textSimilarity('abc', 'xyz')).toBe(0)
  })
})
