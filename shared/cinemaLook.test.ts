import { describe, expect, it } from 'vitest'
import { filmLookOf } from './cinemaLook'

describe('filmLookOf', () => {
  it('is Hollywood when nothing was picked', () => {
    expect(filmLookOf(undefined)).toBe('hollywood')
  })

  it('is the look picked on screen', () => {
    expect(filmLookOf('mono')).toBe('mono')
  })

  it('is no look when なし was picked on screen', () => {
    expect(filmLookOf('none')).toBeNull()
  })
})
