import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import { deleteInboxItem, type InboxItem } from '../utils/inbox'
import { splitShots, DEFAULT_SPLIT_OPTIONS, SplitOptions } from '../utils/splitShots'
import { reconcileShots } from '../utils/reconcileShots'
import { lineJapaneseOf, lineKey, takeLinesOf } from '../utils/subtitleCues'
import { HEARD_VOICES, HEARD_VOICE_LABELS, isHeardVoice } from '../utils/voiceEffects'
import VoiceTry from '../components/VoiceTry'
import { assignToLines, lineImagesOf, reconcileLineImages } from '../utils/lineImages'
import { useLineImages } from '../hooks/useLineImages'
import LineImageEditor from '../components/LineImageEditor'
import { heardPeopleOfInbox, heardPeopleOfShots, SPEAKER_NAME_MAX_LENGTH, withHeardPeople, type HeardPerson } from '../utils/speakerNames'
import { SCENE_MAX_LENGTH } from '../utils/sceneLabel'
import { LineImage, Shot, type CardAudio, type Script, type ScriptCard, type ScriptOpening, type VideoType } from '../types'
import InsertCardEditor, { type EditorCard } from '../components/InsertCardEditor'
import { DEFAULT_CARD_TEXT, cardAudioOf } from '../utils/insertCard'
import { DEFAULT_CARD_BACKGROUND, OPENING_JA_MAX_LENGTH, OPENING_PHRASE_MAX_LENGTH, OPENING_TEXT_MAX_LENGTH, isCardBackgroundName, openingToKeep } from '../../shared/inbox'
import { getCardVoice } from '../utils/cardVoiceStore'
import { DEFAULT_SPEAKER_ICON } from '../utils/speakers'
import styles from './ScriptEditPage.module.css'

const DRAFT_KEY = 'teleprompter_new_script_draft'

const NEW_SCRIPT_SPLIT_OPTIONS: SplitOptions = {
  period: false,
  exclamation: false,
  englishPeriod: false,
  newline: true,
}

/**
 * Which of `lines` are 相手のセリフ, for a script Claude sent with some: by
 * line number while the lines are still as sent, else by their words (twin
 * lines take the marks in turn).
 */
function heardLinesOf(item: InboxItem | undefined, lines: string[], marks: number[] | undefined = item?.heard): (number | null)[] {
  if (!item || !marks?.length) return lines.map(() => null)
  const sent = takeLinesOf(item.body)
  const marked = new Set(marks)
  if (sent.length === lines.length && sent.every((line, i) => lineKey(line) === lineKey(lines[i]))) {
    return lines.map((_, i) => (marked.has(i + 1) ? i + 1 : null))
  }
  const left = sent.flatMap((line, i) => (marked.has(i + 1) ? [{ key: lineKey(line), at: i + 1 }] : []))
  return lines.map(line => {
    const found = left.findIndex(l => l.key === lineKey(line))
    if (found < 0) return null
    return left.splice(found, 1)[0].at
  })
}

/** Who says sent line `at` of a 相手のセリフ script: their icon, voice and role. */
function speakerOfLine(item: InboxItem | undefined, at: number): Pick<Shot, 'speaker' | 'voice' | 'speakerName'> {
  const member = item?.heardCast?.find(m => m.lines.includes(at))
  const icon = member ? member.icon : item?.heardIcon
  const voice = member ? member.voice : item?.heardVoice
  const name = member ? member.name : item?.heardName
  return {
    ...(icon ? { speaker: icon } : {}),
    ...(name ? { speakerName: name } : {}),
    ...(isHeardVoice(voice) && voice !== 'natural' ? { voice } : {}),
  }
}

function generateId() {
  return crypto.randomUUID()
}

/** Who says a line: us, the other person (相手のセリフ), or nobody aloud (心の声). */
type LineRole = 'self' | 'heard' | 'thought'

const ROLE_LABELS: [LineRole, string][] = [
  ['self', '自分'],
  ['heard', '相手'],
  ['thought', '心の声'],
]

function roleOf(shot: Pick<Shot, 'heard' | 'thought'> | undefined): LineRole {
  return shot?.thought ? 'thought' : shot?.heard ? 'heard' : 'self'
}

/** `shot` made `role`'s; one newly the other person's gets `icon`. */
function withRole(shot: Shot, role: LineRole, icon: string): Shot {
  if (role === roleOf(shot)) return shot
  const next: Shot = { ...shot }
  delete next.heard
  delete next.speaker
  delete next.speakerName
  delete next.voice
  delete next.thought
  if (role === 'heard') return { ...next, heard: true, ...(icon !== DEFAULT_SPEAKER_ICON ? { speaker: icon } : {}) }
  if (role === 'thought') return { ...next, thought: true }
  return next
}

/** The cards an existing script or an inbox item starts the editor with. */
function initialCards(existing: Script | undefined, item: InboxItem | undefined): EditorCard[] {
  if (existing) {
    if (existing.oneTake) return []
    return (existing.cards ?? []).flatMap(card => {
      const shot = existing.shots.find(s => s.id === card.afterShotId)
      return shot ? [{ id: card.id, afterText: shot.text, text: card.text, ...(card.background ? { background: card.background } : {}), ...(card.ja ? { ja: card.ja } : {}) }] : []
    })
  }
  const lines = item ? takeLinesOf(item.body) : []
  return (item?.cards ?? []).flatMap(card => {
    const line = lines[card.afterLine - 1]
    return line ? [{ id: generateId(), afterText: line, text: card.text, ...(card.background ? { background: card.background } : {}), ...(card.ja ? { ja: card.ja } : {}) }] : []
  })
}

interface Draft {
  title?: string
  body?: string
  caption?: string
}

function loadDraft(): Draft {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') } catch { return {} }
}

export default function ScriptEditPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const { createScript, updateScript, getScript } = useScripts()
  const [settings] = useSettings()

  const existingScript = id ? getScript(id) : undefined
  const isEdit = Boolean(existingScript)
  // A script sent from Claude chat, opened from Home's inbox section.
  const inboxItem = isEdit ? undefined : (location.state as { inboxItem?: InboxItem } | null)?.inboxItem

  const [initial] = useState(() => {
    if (existingScript) {
      return {
        title: existingScript.title,
        body: existingScript.shots.map(s => s.text).join('\n'),
        caption: existingScript.caption ?? '',
      }
    }
    if (inboxItem) return { title: inboxItem.title, body: inboxItem.body, caption: inboxItem.caption }
    const draft = loadDraft()
    return { title: draft.title ?? '', body: draft.body ?? '', caption: draft.caption ?? '' }
  })
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [caption, setCaption] = useState(initial.caption)
  const [preview, setPreview] = useState<string[]>(
    () => existingScript ? existingScript.shots.map(s => s.text) : []
  )
  const [splitOptions, setSplitOptions] = useState<SplitOptions>(
    () => existingScript ? DEFAULT_SPLIT_OPTIONS : NEW_SCRIPT_SPLIT_OPTIONS
  )
  // 一発撮り is the usual way to film now (2026-10-21), so new scripts start with it.
  // A script with 相手のセリフ is filmed line by line: the voice of such a line goes over its own listening take.
  const [oneTake, setOneTake] = useState<boolean>(() => existingScript ? Boolean(existingScript.oneTake) : !inboxItem?.heard?.length)
  // Type A/B only labels the video for the weekly comparison now (2026-11-05); Claude sends it with the script.
  const [videoType, setVideoType] = useState<VideoType | null>(
    () => (existingScript ? existingScript.videoType : inboxItem?.videoType) ?? null,
  )
  const [lineImages, setLineImages] = useState<LineImage[]>(() => {
    if (existingScript) return existingScript.lineImages ?? []
    return inboxItem?.images ? lineImagesOf(inboxItem.body, inboxItem.images) : []
  })
  const { stored: storedImages, loading: imagesLoading, retry: retryImages } = useLineImages(lineImages, settings.inboxKey)
  // 相手のセリフ: each other person's role, burned beside their icon.
  const [people, setPeople] = useState<HeardPerson[]>(
    () => existingScript ? heardPeopleOfShots(existingScript.shots) : heardPeopleOfInbox(inboxItem),
  )
  // The few words on where it happens, over line 1.
  const [scene, setScene] = useState<string>(() => (existingScript ? existingScript.scene : inboxItem?.scene) ?? '')
  // 冒頭カード: the sentence typed out before line 1, and its Japanese.
  const [openingText, setOpeningText] = useState<string>(() => (existingScript ? existingScript.opening?.text : inboxItem?.opening?.text) ?? '')
  const [openingJa, setOpeningJa] = useState<string>(() => (existingScript ? existingScript.opening?.ja : inboxItem?.opening?.ja) ?? '')
  const [openingPhrase, setOpeningPhrase] = useState<string>(() => (existingScript ? existingScript.opening?.phrase : inboxItem?.opening?.phrase) ?? '')
  // 自分 / 相手 / 心の声 picked here for a line (by its words), over what the script or Claude said.
  const [roleOverrides, setRoleOverrides] = useState<Map<string, LineRole>>(() => new Map())
  // 挿入カード between lines, and what they do to the sound.
  const [cards, setCards] = useState<EditorCard[]>(() => initialCards(existingScript, inboxItem))
  // Which of an existing script's cards have a recorded voice (an inbox item has none yet).
  const [voiceCardIds, setVoiceCardIds] = useState<Set<string>>(() => new Set())
  const existingId = existingScript?.id
  useEffect(() => {
    if (!existingId) return
    let cancelled = false
    const ids = (existingScript?.cards ?? []).map(c => c.id)
    Promise.all(ids.map(cardId => getCardVoice(existingId, cardId).then(v => (v ? cardId : null), () => null))).then(found => {
      if (!cancelled) setVoiceCardIds(new Set(found.filter((x): x is string => x !== null)))
    })
    return () => {
      cancelled = true
    }
    // The cards are read once, as the editor starts with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingId])
  const [cardAudio, setCardAudio] = useState<CardAudio>(() => cardAudioOf(existingScript))

  // Grow the textarea to fit its content so a long pasted script is visible
  // in full, instead of hiding most of it in a small scroll box nested
  // inside the scrolling page.
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    // Resetting the height briefly shortens the page, which would clamp and
    // jump the surrounding scroll position; restore it after measuring.
    const scroller = el.parentElement
    const scrollTop = scroller?.scrollTop ?? 0
    el.style.height = 'auto'
    if (el.scrollHeight > el.clientHeight) {
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
    }
    if (scroller) scroller.scrollTop = scrollTop
  }, [body])

  function saveDraft(next: Partial<Draft>) {
    // An inbox item must not overwrite the hand-typed new-script draft.
    if (!isEdit && !inboxItem) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body, caption, ...next }))
    }
  }

  function clearDraft() {
    sessionStorage.removeItem(DRAFT_KEY)
  }

  function handleSplit() {
    if (oneTake) {
      // One shot holding every line; each line becomes one subtitle.
      const lines = splitShots(body, NEW_SCRIPT_SPLIT_OPTIONS)
      setPreview(lines.length > 0 ? [lines.join('\n')] : [])
      // The images stay with their lines, wherever the edit put them.
      setLineImages(images => reconcileLineImages(images, lines))
      return
    }
    const segments = splitShots(body, splitOptions)
    setPreview(segments)
    setLineImages(images => reconcileLineImages(images, segments.flatMap(takeLinesOf)))
  }

  /** Put `image` on `line`, or take that line's away with null. */
  function setLineImage(line: string, old: LineImage | null, image: LineImage | null) {
    setLineImages(images => [...images.filter(i => i !== old), ...(image ? [{ ...image, en: line }] : [])])
  }

  function handleNext() {
    if (!title.trim()) {
      alert('タイトルを入力してください')
      return
    }
    if (preview.length === 0) {
      alert('テキストを入力して「自動分割」してください')
      return
    }

    if (existingScript) {
      const shots = withHeardPeople(withRoles(reconcileShots(existingScript.shots, preview, generateId)), people)
      updateScript(existingScript.id, { title: title.trim(), shots, caption: caption.trim(), oneTake, videoType: videoType ?? undefined, lineImages, scene: scene.trim(), opening: openingToSave(), cards: scriptCardsOf(shots), cardAudio: cardAudioToSave() })
      navigate(`/scripts/${existingScript.id}/shots`)
    } else {
      const heard = oneTake ? [] : heardLinesOf(inboxItem, preview)
      const shots: Shot[] = withHeardPeople(withRoles(preview.map((text, i) => {
        const at = heard[i]
        return { id: generateId(), text, ...(at ? { heard: true, ...speakerOfLine(inboxItem, at) } : {}) }
      })), people)
      // Kept against the lines as Claude sent them: edits made here just
      // leave those lines for the subtitle step's Claude用プロンプト.
      const japanese = inboxItem?.japanese ? lineJapaneseOf(inboxItem.body, inboxItem.japanese) : undefined
      const script = createScript(title.trim(), shots, caption.trim(), oneTake, japanese, videoType ?? undefined, lineImages, scene.trim(), inboxItem?.cover, {
        cards: scriptCardsOf(shots),
        cardAudio: cardAudioToSave(),
        opening: openingToSave(),
        ...(inboxItem?.translationOnly && japanese?.length ? { translationOnly: true } : {}),
      })
      if (!inboxItem) clearDraft()
      if (inboxItem && settings.inboxKey) {
        // Taken: clear it from the inbox so no device offers it again. If
        // this fails the item just lingers until it expires.
        deleteInboxItem(settings.inboxKey, inboxItem.id)
          .catch(err => console.error('Failed to clear the inbox item', err))
      }
      // From the inbox, replace the /scripts/new entry: it carries the
      // consumed item in its state, and going back would reopen it
      // pre-filled and let it be saved a second time.
      navigate(`/scripts/${script.id}/shots`, { replace: Boolean(inboxItem) })
    }
  }

  const shownLines = preview.length === 0 ? [] : oneTake ? preview[0].split('\n') : preview
  const imageOfLine = assignToLines(lineImages, shownLines)

  // What each line is, before anything picked here: as the script has it, or as Claude sent it.
  const baseRoles: LineRole[] = (() => {
    if (oneTake) return preview.map(() => 'self')
    if (existingScript) return reconcileShots(existingScript.shots, preview, () => '').map(roleOf)
    const heard = heardLinesOf(inboxItem, preview)
    const thought = heardLinesOf(inboxItem, preview, inboxItem?.thought ?? [])
    return preview.map((_, i) => (thought[i] ? 'thought' : heard[i] ? 'heard' : 'self'))
  })()
  const roles: LineRole[] = preview.map((text, i) => roleOverrides.get(lineKey(text)) ?? baseRoles[i])

  /** `shots` (one per line of the preview) each made the role picked for it. */
  function withRoles(shots: Shot[]): Shot[] {
    if (oneTake) return shots
    const icon = people[0]?.icon ?? DEFAULT_SPEAKER_ICON
    return shots.map((shot, i) => withRole(shot, roles[i] ?? 'self', shot.speaker ?? icon))
  }

  function setRole(text: string, role: LineRole) {
    setRoleOverrides(all => new Map(all).set(lineKey(text), role))
    // The other person needs a row for their role and voice.
    if (role === 'heard' && people.length === 0) setPeople([{ icon: DEFAULT_SPEAKER_ICON, name: '', voice: 'natural' }])
  }

  /** The line a card follows, by index in the preview; -1 when that line is gone. */
  const cardIndexOf = (card: EditorCard) => preview.findIndex(text => lineKey(text) === lineKey(card.afterText))
  const shownCards = oneTake ? [] : cards.filter(card => {
    const at = cardIndexOf(card)
    return at >= 0 && at < preview.length - 1
  })

  /** The cards as the script keeps them: after a shot, by its id. */
  function scriptCardsOf(shots: Shot[]): ScriptCard[] {
    return shownCards.flatMap(card => {
      const shot = shots[cardIndexOf(card)]
      const text = card.text.trim()
      if (!shot || !text) return []
      const background = card.background && (isCardBackgroundName(card.background) || card.background.startsWith('https://')) && card.background !== DEFAULT_CARD_BACKGROUND ? card.background : undefined
      const ja = card.ja?.trim()
      return [{ id: card.id, afterShotId: shot.id, text, ...(background ? { background } : {}), ...(ja ? { ja } : {}) }]
    })
  }

  /** Both on is what a script without the setting means, so only an off is kept. */
  function openingToSave(): ScriptOpening | undefined {
    return openingToKeep({ text: openingText, ja: openingJa, phrase: openingPhrase }) ?? undefined
  }

  function cardAudioToSave(): CardAudio | undefined {
    return cardAudio.muffle && cardAudio.sound ? undefined : cardAudio
  }

  function addCard(afterText: string) {
    setCards(all => [...all, { id: generateId(), afterText, text: DEFAULT_CARD_TEXT }])
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>
          {isEdit ? 'スクリプト編集' : '新規スクリプト'}
        </h1>
      </header>

      <div className={styles.body}>
        <label className={styles.label} htmlFor="script-title">タイトル</label>
        <input
          id="script-title"
          className={styles.titleInput}
          type="text"
          placeholder="例：商品紹介動画"
          value={title}
          onChange={e => { setTitle(e.target.value); saveDraft({ title: e.target.value }) }}
        />

        <label className={styles.label} htmlFor="script-body">スクリプト全文</label>
        <textarea
          id="script-body"
          ref={bodyRef}
          className={styles.textarea}
          placeholder="ここにスクリプトを入力または貼り付け..."
          value={body}
          onChange={e => {
            setBody(e.target.value)
            setPreview([])
            saveDraft({ body: e.target.value })
          }}
          rows={8}
        />

        <label className={styles.splitOptionItem}>
          <input
            type="checkbox"
            checked={oneTake}
            onChange={e => {
              setOneTake(e.target.checked)
              setPreview([])
            }}
          />
          一発撮り（最初から最後まで1回で撮る。字幕は1行ずつ自動で切り替え）
        </label>

        <div className={styles.splitOptions} role="group" aria-label="動画の型">
          <span className={styles.splitOptionsLabel}>動画の型（分析用の記録です。冒頭の演出は変わりません）</span>
          <div className={styles.splitOptionsList}>
            {([
              [null, 'なし'],
              ['A', 'A: 2021年型'],
              ['B', 'B: 表現ノート型'],
            ] as const).map(([value, label]) => (
              <label key={label} className={styles.splitOptionItem}>
                <input
                  type="radio"
                  name="videoType"
                  checked={videoType === value}
                  onChange={() => setVideoType(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {!oneTake && (
        <div className={styles.splitOptions}>
          <span className={styles.splitOptionsLabel}>区切り単位</span>
          <div className={styles.splitOptionsList}>
            {([
              ['period', '句点（。）'],
              ['exclamation', '感嘆・疑問符（！？）'],
              ['englishPeriod', '英語ピリオド（.）'],
              ['newline', '改行'],
            ] as const).map(([key, label]) => (
              <label key={key} className={styles.splitOptionItem}>
                <input
                  type="checkbox"
                  checked={splitOptions[key]}
                  onChange={e => setSplitOptions(o => ({ ...o, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        )}

        <button className={styles.splitBtn} onClick={handleSplit}>
          {oneTake ? '行に分ける' : '自動分割する'}
        </button>

        {preview.length > 0 && (
          <div className={styles.preview}>
            <p className={styles.previewLabel}>
              {oneTake
                ? `一発撮り（字幕${preview[0].split('\n').length}行）`
                : `分割結果（${preview.length}ショット）`}
            </p>
            {lineImages.length > 0 && (
              <p className={styles.previewLabel}>画像がある台本なので、ステッカーと妖精は出ません</p>
            )}
            {shownLines.map((text, i) => {
              const cardsHere = shownCards.filter(card => cardIndexOf(card) === i)
              return (
              <div key={i}>
              <div className={styles.previewItem}>
                <span className={styles.previewNum}>{i + 1}</span>
                <div className={styles.previewLine}>
                  <span className={`${styles.previewText} ${roles[i] === 'thought' ? styles.previewThought : ''}`}>{text}</span>
                  {!oneTake && (
                    <div className={styles.roleSwitch} role="radiogroup" aria-label={`${i + 1}行目は誰の`}>
                      {ROLE_LABELS.map(([role, label]) => (
                        <button
                          key={role}
                          type="button"
                          role="radio"
                          aria-checked={roles[i] === role}
                          className={`${styles.roleBtn} ${roles[i] === role ? styles.roleBtnActive : ''}`}
                          onClick={() => setRole(text, role)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <LineImageEditor
                    line={text}
                    image={imageOfLine[i]}
                    stored={imageOfLine[i] ? storedImages.get(imageOfLine[i]!.imageId) : undefined}
                    loading={imagesLoading}
                    onChange={image => setLineImage(text, imageOfLine[i], image)}
                    onRetry={retryImages}
                  />
                </div>
              </div>
              {cardsHere.map(card => (
                <InsertCardEditor
                  key={card.id}
                  card={card}
                  hasVoice={voiceCardIds.has(card.id)}
                  onChange={next => setCards(all => all.map(c => (c.id === card.id ? next : c)))}
                  onRemove={() => setCards(all => all.filter(c => c.id !== card.id))}
                />
              ))}
              {!oneTake && i < shownLines.length - 1 && cardsHere.length === 0 && (
                <button type="button" className={styles.addCardBtn} onClick={() => addCard(text)}>
                  ＋ ここにカードを入れる（例: 2 days later）
                </button>
              )}
              </div>
              )
            })}
            {shownCards.length > 0 && (
              <div className={styles.splitOptions} role="group" aria-label="カードの音">
                <span className={styles.splitOptionsLabel}>カードの音</span>
                <label className={styles.splitOptionItem}>
                  <input type="checkbox" checked={cardAudio.muffle} onChange={e => setCardAudio(a => ({ ...a, muffle: e.target.checked }))} />
                  カードの間はBGMを小さく、こもった音にする
                </label>
                <label className={styles.splitOptionItem}>
                  <input type="checkbox" checked={cardAudio.sound} onChange={e => setCardAudio(a => ({ ...a, sound: e.target.checked }))} />
                  カードが出るときに効果音を鳴らす
                </label>
              </div>
            )}
          </div>
        )}

        {!oneTake && people.length > 0 && (
          <div className={styles.splitOptions} role="group" aria-label="相手の役名">
            <span className={styles.splitOptionsLabel}>相手の役名と声（役名は任意。アイコンの横に小さく出ます。声は撮った動画をインポートするときにかかります）</span>
            {people.map(person => (
              <div key={person.icon} className={styles.heardPerson}>
                <span aria-hidden="true" className={styles.heardPersonIcon}>{person.icon}</span>
                <input
                  className={styles.titleInput}
                  type="text"
                  aria-label={`${person.icon} の役名`}
                  placeholder="例: Mom / Boss / Hairdresser"
                  maxLength={SPEAKER_NAME_MAX_LENGTH}
                  value={person.name}
                  onChange={e => {
                    const name = e.target.value
                    setPeople(all => all.map(p => (p.icon === person.icon ? { ...p, name } : p)))
                  }}
                />
                <select
                  aria-label={`${person.icon} の声`}
                  value={person.voice}
                  onChange={e => {
                    const voice = e.target.value
                    if (isHeardVoice(voice)) setPeople(all => all.map(p => (p.icon === person.icon ? { ...p, voice } : p)))
                  }}
                >
                  {HEARD_VOICES.map(voice => (
                    <option key={voice} value={voice}>{HEARD_VOICE_LABELS[voice]}</option>
                  ))}
                </select>
                <VoiceTry voice={person.voice} />
              </div>
            ))}
          </div>
        )}

        <label className={styles.label} htmlFor="script-scene">状況のラベル（任意。1行目のあいだ、字幕のすぐ下に「SCENE」タグ付きで出ます）</label>
        <input
          id="script-scene"
          className={styles.titleInput}
          type="text"
          placeholder="例: a wrong number / online meeting"
          maxLength={SCENE_MAX_LENGTH}
          value={scene}
          onChange={e => setScene(e.target.value)}
        />

        <label className={styles.label} htmlFor="script-opening">冒頭カード（任意。1行目の前に、暗い幕の上で英語の1文をタイプライターで打ちます。あると状況のラベルは出ません）</label>
        <input
          id="script-opening"
          className={styles.titleInput}
          type="text"
          placeholder="例: My mom called me at 3 a.m."
          maxLength={OPENING_TEXT_MAX_LENGTH}
          value={openingText}
          onChange={e => setOpeningText(e.target.value)}
        />
        {openingText.trim() && (
          <input
            aria-label="冒頭カードの日本語"
            className={styles.titleInput}
            type="text"
            placeholder="日本語（任意。英語の下に小さく出ます）"
            maxLength={OPENING_JA_MAX_LENGTH}
            value={openingJa}
            onChange={e => setOpeningJa(e.target.value)}
          />
        )}
        {openingText.trim() && (
          <input
            aria-label="今日のフレーズ"
            className={styles.titleInput}
            type="text"
            placeholder="今日のフレーズ（任意。英語の中の語句。例: I'm down）"
            maxLength={OPENING_PHRASE_MAX_LENGTH}
            value={openingPhrase}
            onChange={e => setOpeningPhrase(e.target.value)}
          />
        )}

        <label className={styles.label} htmlFor="script-caption">キャプション（任意）</label>
        <textarea
          id="script-caption"
          className={`${styles.textarea} ${styles.captionTextarea}`}
          placeholder="TikTokに投稿するときのキャプション"
          value={caption}
          onChange={e => {
            setCaption(e.target.value)
            saveDraft({ caption: e.target.value })
          }}
          rows={4}
        />
      </div>

      <div className={styles.footer}>
        <button
          className={styles.nextBtn}
          onClick={handleNext}
          disabled={preview.length === 0}
        >
          編集へ進む →
        </button>
      </div>
    </div>
  )
}
