import { useEffect, useRef, useState } from 'react'
import { CARD_BACKGROUNDS, CARD_JA_MAX_LENGTH, CARD_TEXT_MAX_LENGTH, DEFAULT_CARD_BACKGROUND, isCardBackgroundName } from '../../shared/inbox'
import { CARD_BACKGROUND_LABELS, CARD_SECONDS, cardBackgroundOf, wobblesOf } from '../utils/insertCard'
import { drawCardFrame, layoutCardText } from '../utils/drawInsertCard'
import styles from './InsertCardEditor.module.css'

/** The card as the editor holds it: its text, background, and the line it follows (by its words). */
export interface EditorCard {
  id: string
  afterText: string
  text: string
  background?: string
  /** The text in Japanese, small under it. */
  ja?: string
}

const PREVIEW_WIDTH = 1080
const PREVIEW_HEIGHT = 1920
/** The preview loops with a short rest between plays, so the pop-in is seen again. */
const LOOP_SECONDS = CARD_SECONDS + 0.5

/**
 * The card as it will be burned, drawn with the burn's own drawing and
 * timing (drawCardFrame), playing on a loop.
 */
export function InsertCardPreview({ text, background, ja }: { text: string; background?: string; ja?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const parsed = cardBackgroundOf(background)
  const imageUrl = parsed.kind === 'image' ? parsed.url : null

  useEffect(() => {
    setImage(null)
    if (!imageUrl) return
    const img = new Image()
    img.onload = () => setImage(img)
    img.src = imageUrl
    return () => {
      img.onload = null
    }
  }, [imageUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    // jsdom (the tests) has no canvas to draw on.
    if (!canvas || /jsdom/.test(navigator.userAgent)) return
    const ctx = canvas.getContext('2d')
    if (!canvas || !ctx) return
    const layout = layoutCardText(text, PREVIEW_WIDTH, (t, font) => {
      ctx.font = font
      return ctx.measureText(t).width
    }, undefined, ja)
    const wobbles = wobblesOf(layout.letters.map(l => l.ch).join(''))
    const shownBackground = parsed.kind === 'image' && !image ? { kind: 'named' as const, name: DEFAULT_CARD_BACKGROUND } : parsed
    const started = performance.now()
    let frame = 0
    const draw = (now: number) => {
      const t = ((now - started) / 1000) % LOOP_SECONDS
      ctx.setTransform(canvas.width / PREVIEW_WIDTH, 0, 0, canvas.height / PREVIEW_HEIGHT, 0, 0)
      drawCardFrame(ctx, PREVIEW_WIDTH, PREVIEW_HEIGHT, layout, wobbles, Math.min(t, CARD_SECONDS), shownBackground, image ?? undefined)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
    // `parsed` is read through `background`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, background, ja, image])

  return <canvas ref={canvasRef} className={styles.preview} width={216} height={384} aria-label={`カードのプレビュー: ${text}`} />
}

interface InsertCardEditorProps {
  card: EditorCard
  onChange: (card: EditorCard) => void
  onRemove: () => void
  /** The card has a recorded narrator voice on this device. */
  hasVoice?: boolean
}

/** One card between two lines: its words, its background, and how it looks. */
export default function InsertCardEditor({ card, onChange, onRemove, hasVoice }: InsertCardEditorProps) {
  const isImage = cardBackgroundOf(card.background).kind === 'image'
  const [urlDraft, setUrlDraft] = useState(isImage ? (card.background ?? '') : '')
  const choice = isImage || (card.background !== undefined && !isCardBackgroundName(card.background) && card.background !== '') ? 'image' : (card.background ?? DEFAULT_CARD_BACKGROUND)
  return (
    <div className={styles.card} data-testid="insert-card">
      <div className={styles.fields}>
        <span className={styles.badge}>{hasVoice ? '🎬 カード（声の長さ）🎙️ 声あり' : `🎬 カード（${CARD_SECONDS}秒）`}</span>
        <input
          className={styles.input}
          type="text"
          aria-label="カードの文字"
          maxLength={CARD_TEXT_MAX_LENGTH}
          value={card.text}
          placeholder="2 days later"
          onChange={e => onChange({ ...card, text: e.target.value })}
        />
        <input
          className={styles.input}
          type="text"
          aria-label="カードの日本語"
          maxLength={CARD_JA_MAX_LENGTH}
          value={card.ja ?? ''}
          placeholder="日本語（英語の下に小さく。例: 2日後）"
          onChange={e => onChange({ ...card, ja: e.target.value })}
        />
        <select
          aria-label="カードの背景"
          value={choice}
          onChange={e => {
            const value = e.target.value
            if (value === 'image') onChange({ ...card, background: urlDraft.startsWith('https://') ? urlDraft : 'image' })
            else onChange({ ...card, background: value === DEFAULT_CARD_BACKGROUND ? undefined : value })
          }}
        >
          {CARD_BACKGROUNDS.map(name => (
            <option key={name} value={name}>{CARD_BACKGROUND_LABELS[name]}</option>
          ))}
          <option value="image">画像（URL）</option>
        </select>
        {choice === 'image' && (
          <input
            className={styles.input}
            type="url"
            aria-label="背景の画像のURL"
            placeholder="https://…（画像そのもののURL）"
            value={urlDraft}
            onChange={e => {
              setUrlDraft(e.target.value)
              onChange({ ...card, background: e.target.value.startsWith('https://') ? e.target.value.trim() : 'image' })
            }}
          />
        )}
        <button type="button" className={styles.remove} onClick={onRemove}>カードを外す</button>
      </div>
      <InsertCardPreview text={card.text || ' '} background={card.background} ja={card.ja} />
    </div>
  )
}
