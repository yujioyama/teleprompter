import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import InsertCardEditor from './InsertCardEditor'
import { CARD_SECONDS } from '../utils/insertCard'

const card = { id: 'c1', afterText: '一行目', text: '2 days later' }
const noop = () => {}

describe('InsertCardEditor badge', () => {
  it('shows 声あり, lasting as long as the voice, when the card has a voice', () => {
    render(<InsertCardEditor card={card} hasVoice onChange={noop} onRemove={noop} />)
    expect(screen.getByText('🎬 カード（声の長さ）🎙️ 声あり')).toBeTruthy()
    expect(screen.queryByText(new RegExp(`${CARD_SECONDS}秒`))).toBeNull()
  })

  it('does not show 声あり without a voice', () => {
    render(<InsertCardEditor card={card} onChange={noop} onRemove={noop} />)
    expect(screen.getByText(`🎬 カード（${CARD_SECONDS}秒）`)).toBeTruthy()
    expect(screen.queryByText(/声あり/)).toBeNull()
  })
})
