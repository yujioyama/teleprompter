import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import { SubtitleCue } from '../utils/subtitleCues'
import { clampedSubtitlePosition } from '../utils/subtitlePosition'
import { createCanvasMeasure, layoutCue } from '../utils/subtitleLayout'
import { placeSticker } from '../utils/stickerMotion'
import { styleCues } from '../utils/subtitleHook'
import { STICKER_EMOJI_PX, STICKER_PLACEMENTS } from '../utils/subtitleSticker'
import type { FairyAppearance } from '../utils/fairyPlan'

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

  it('moves the sticker along the same path as the burn, and leaves it put with no motion', () => {
    const cues: SubtitleCue[] = [{ id: 'c1', start: 0, end: 1, en: 'I put *Vaseline*🧴 on', ja: 'ワセリン' }]
    const hook = { ...HOOK, sticker: 'right' as const, stickerMotion: 'orbit' as const, stickerRoute: 0 }
    const path = placeSticker(styleCues(cues, 3, true), hook, 3)!.path!
    const { rerender } = render(<SubtitleOverlayPreview cues={cues} position={72} currentTime={1} hook={hook} firstShotDuration={3} />)
    const at = path(1)
    const style = screen.getByTestId('subtitle-sticker').style
    expect(style.left).toBe(`${at.x * 100}%`)
    expect(style.top).toBe(`${at.y * 100}%`)
    expect(style.transform).toBe(`translate(-50%, -50%) rotate(${at.rotation}deg) scale(${at.scale})`)

    rerender(<SubtitleOverlayPreview cues={cues} position={72} currentTime={1} hook={{ ...hook, stickerMotion: 'none' }} firstShotDuration={3} />)
    expect(screen.getByTestId('subtitle-sticker').style.left).toBe(`${STICKER_PLACEMENTS.right.x * 100}%`)
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

  const FAIRY = {
    emoji: '💡', kind: 'cameo', start: 2.3, end: 3.5,
    path: () => ({ x: 0.3, y: 0.5, rotation: 0, scale: 1 }),
    scale: 0.62, sparkles: [], key: 'k',
  } as FairyAppearance

  it('shows a fairy only during its window', () => {
    const { rerender } = render(<SubtitleOverlayPreview cues={[]} position={72} currentTime={2.5} fairies={[FAIRY]} />)
    expect(screen.getByTestId('subtitle-fairy')).toHaveTextContent('💡')
    rerender(<SubtitleOverlayPreview cues={[]} position={72} currentTime={3.6} fairies={[FAIRY]} />)
    expect(screen.queryByTestId('subtitle-fairy')).toBeNull()
  })

  it('draws a fairy at its pose scale times its own scale', () => {
    const path = () => ({ x: 0.3, y: 0.5, rotation: 10, scale: 1.2 })
    render(<SubtitleOverlayPreview cues={[]} position={72} currentTime={2.5} fairies={[{ ...FAIRY, path }]} />)
    const style = screen.getByTestId('subtitle-fairy').style
    expect(style.left).toBe('30%')
    expect(style.top).toBe('50%')
    expect(style.transform).toBe(`translate(-50%, -50%) rotate(10deg) scale(${1.2 * 0.62})`)
  })

  it('fades the finale with its pose opacity', () => {
    const path = () => ({ x: 0.5, y: 0.5, rotation: 0, scale: 1, opacity: 0.4 })
    render(<SubtitleOverlayPreview cues={[]} position={72} currentTime={2.5} fairies={[{ ...FAIRY, kind: 'finale', path }]} />)
    expect(screen.getByTestId('subtitle-fairy').style.opacity).toBe('0.4')
  })

  it('keeps every emoji out of a normal cue\'s text', () => {
    const cues: SubtitleCue[] = [{ id: 'c1', start: 0, end: 2, en: 'It keeps them 💡 neat', ja: 'きれい' }]
    render(<SubtitleOverlayPreview cues={cues} position={50} currentTime={1} />)
    const text = screen.getByTestId('subtitle-overlay-box').textContent ?? ''
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(text).toContain('neat')
  })

  it('draws the sticker at 200px', () => {
    const cues: SubtitleCue[] = [{ id: 'c1', start: 0, end: 1, en: 'I put *Vaseline*🧴 on', ja: 'ワセリン' }]
    render(<SubtitleOverlayPreview cues={cues} position={72} currentTime={0.5} hook={HOOK} firstShotDuration={2} />)
    // jsdom drops cqw lengths, so the size can't be read back from the style: pin the constant it is built from.
    expect(STICKER_EMOJI_PX).toBe(200)
    expect(screen.getByTestId('subtitle-sticker')).toBeInTheDocument()
  })

  describe('sparkle canvas', () => {
    const originalRO = globalThis.ResizeObserver
    afterEach(() => {
      globalThis.ResizeObserver = originalRO
      vi.restoreAllMocks()
    })

    it('renders only while a fairy or the sticker is shown', () => {
      const { container, rerender } = render(<SubtitleOverlayPreview cues={[]} position={72} currentTime={2.5} fairies={[FAIRY]} />)
      const canvas = container.querySelector('canvas')!
      expect(canvas).not.toBeNull()
      expect(canvas.className).toMatch(/sparkles/)
      rerender(<SubtitleOverlayPreview cues={[]} position={72} currentTime={9} fairies={[FAIRY]} />)
      expect(container).toBeEmptyDOMElement()
    })

    it('does not draw where there is no 2d context, and survives a missing ResizeObserver', () => {
      // @ts-expect-error simulating a browser without it
      delete globalThis.ResizeObserver
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
      render(<SubtitleOverlayPreview cues={[]} position={72} currentTime={2.5} fairies={[FAIRY]} />)
      expect(getContext).not.toHaveBeenCalled()
    })

    it('draws the active fairy\'s sparkles on the canvas', () => {
      const ctx = {
        clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
        quadraticCurveTo: vi.fn(), fill: vi.fn(), globalAlpha: 1, fillStyle: '',
      }
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
      class FakeRO {
        constructor(private cb: ResizeObserverCallback) {}
        observe(el: Element) {
          this.cb([{ target: el, contentRect: { width: 360, height: 640 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
        }
        unobserve() {}
        disconnect() {}
      }
      globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver
      const sparkle = { born: 2.4, life: 0.5, x: 0.3, y: 0.5, vx: 0, vy: 0, radius: 20, color: '#fff' }
      render(<SubtitleOverlayPreview cues={[]} position={72} currentTime={2.5} fairies={[{ ...FAIRY, sparkles: [sparkle] }]} />)
      expect(ctx.clearRect).toHaveBeenCalled()
      expect(ctx.fill).toHaveBeenCalled()
    })
  })
})
