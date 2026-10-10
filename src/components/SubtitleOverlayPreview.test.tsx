import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import { SubtitleCue } from '../utils/subtitleCues'
import { clampedSubtitlePosition } from '../utils/subtitlePosition'
import { createCanvasMeasure, layoutCue } from '../utils/subtitleLayout'

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

  it('wraps a long cue onto several lines instead of one overflowing line', () => {
    const long: SubtitleCue[] = [{
      id: 'c1', start: 0, end: 5,
      en: 'I was sure the other singer would go through. In my head, I had a very clear thought.',
      ja: '絶対もう一人の歌手が通ると思ってたんだ。頭の中では、日本語ではっきり考えてた。',
    }]
    render(<SubtitleOverlayPreview cues={long} position={50} currentTime={1} />)
    const box = screen.getByTestId('subtitle-overlay-box')
    const [en, ja] = box.querySelectorAll('p')
    expect(en.children.length).toBeGreaterThan(1)
    expect(ja.children.length).toBeGreaterThan(1)
    expect(Array.from(en.children, c => c.textContent).join(' ')).toBe(long[0].en)
  })

  const HOOK = { style: true, position: 50, punchIn: null }

  it('shows the first shot\'s cue in hook style at the hook position', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={72} currentTime={1} hook={HOOK} firstShotDuration={2} />)
    const box = screen.getByTestId('subtitle-overlay-box')
    expect(box).toHaveAttribute('data-variant', 'hook')
    expect(box.style.top).toBe('50%')
    expect(box.style.backgroundColor).toBe('')
    expect(box.querySelectorAll('p')).toHaveLength(2)
    expect(within(box).getByText('こんにちは')).toBeInTheDocument()
  })

  it('shows a hook cue\'s emoji as a sticker through the first shot, not in its text', () => {
    const cues: SubtitleCue[] = [
      { id: 'c1', start: 0, end: 1, en: 'I put *Vaseline*🧴 on', ja: 'ワセリン' },
      { id: 'c2', start: 1, end: 4, en: 'Every night', ja: '毎晩' },
    ]
    const { rerender } = render(
      <SubtitleOverlayPreview cues={cues} position={72} currentTime={0.5} hook={HOOK} firstShotDuration={2} />,
    )
    expect(screen.getByTestId('subtitle-sticker')).toHaveTextContent('🧴')
    expect(screen.getByTestId('subtitle-overlay-box')).not.toHaveTextContent('🧴')

    rerender(<SubtitleOverlayPreview cues={cues} position={72} currentTime={1.5} hook={HOOK} firstShotDuration={2} />)
    expect(screen.getByTestId('subtitle-sticker')).toBeInTheDocument()

    rerender(<SubtitleOverlayPreview cues={cues} position={72} currentTime={2.5} hook={HOOK} firstShotDuration={2} />)
    expect(screen.queryByTestId('subtitle-sticker')).not.toBeInTheDocument()
  })

  it('keeps a tall hook box on screen, as the burn does', () => {
    const cue: SubtitleCue = {
      id: 'c1', start: 0, end: 2,
      en: 'I was sure the other singer would go through, and I told everyone.',
      ja: '絶対もう一人の歌手が通ると思ってたし、みんなにもそう言ってたんだ。',
    }
    render(
      <SubtitleOverlayPreview cues={[cue]} position={72} currentTime={1} hook={{ style: true, position: 0, punchIn: null }} firstShotDuration={2} />,
    )
    const box = screen.getByTestId('subtitle-overlay-box')
    const { height } = layoutCue(cue, createCanvasMeasure())
    expect(box.style.top).toBe(`${clampedSubtitlePosition(0, height)}%`)
    expect(parseFloat(box.style.top)).toBeGreaterThan(0)
  })

  it('shows later cues normally', () => {
    render(<SubtitleOverlayPreview cues={CUES} position={72} currentTime={3} hook={HOOK} firstShotDuration={2} />)
    const box = screen.getByTestId('subtitle-overlay-box')
    expect(box).toHaveAttribute('data-variant', 'normal')
    expect(box.style.top).toBe('72%')
    expect(box.style.backgroundColor).toBe('')
    expect(screen.getByText('ケノービ将軍')).toBeInTheDocument()
  })

  it('shows a transcribed first cue from 0s with the hook style, as timed without it', () => {
    const late: SubtitleCue[] = [{ id: 's0', start: 0.3, end: 1.2, en: 'So', ja: 'で' }]
    const { rerender, container } = render(
      <SubtitleOverlayPreview cues={late} position={72} currentTime={0.1} hook={HOOK} firstShotDuration={2} />,
    )
    expect(screen.getByText('So')).toBeInTheDocument()
    rerender(<SubtitleOverlayPreview cues={late} position={72} currentTime={0.1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('paints an *emphasized* word yellow, without the asterisks', () => {
    const cues: SubtitleCue[] = [{ id: 'c1', start: 0, end: 2, en: 'I *love* it', ja: 'すき' }]
    render(<SubtitleOverlayPreview cues={cues} position={50} currentTime={1} />)
    expect(screen.getByText('love')).toHaveStyle({ color: '#FFD60A' })
    expect(screen.queryByText(/\*/)).not.toBeInTheDocument()
  })
})
