import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import { SubtitleCue } from '../utils/subtitleCues'

const CUES: SubtitleCue[] = [
  { id: 'c1', start: 0, end: 2, en: 'Hello there', ja: 'こんにちは' },
  { id: 'c2', start: 2, end: 4, en: 'General Kenobi', ja: 'ケノービ将軍' },
]

describe('SubtitleOverlayPreview', () => {
  it('renders the cue whose start/end window contains currentTime', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={50} currentTime={1} />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
    expect(screen.getByText('こんにちは')).toBeInTheDocument()
    expect(screen.queryByText('General Kenobi')).not.toBeInTheDocument()
  })

  it('switches to the next cue once currentTime passes into its window', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={50} currentTime={3} />)
    expect(screen.getByText('General Kenobi')).toBeInTheDocument()
    expect(screen.queryByText('Hello there')).not.toBeInTheDocument()
  })

  it('renders nothing when currentTime matches no cue', () => {
    const { container } = render(<SubtitleOverlayPreview cues={CUES} position={50} currentTime={10} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('positions the overlay at the given percent from the top', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={72} currentTime={1} />)
    const box = screen.getByTestId('subtitle-overlay-box')
    expect(box.style.top).toBe('72%')
  })
})
