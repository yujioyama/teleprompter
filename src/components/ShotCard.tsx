import { useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Shot } from '../types'
import styles from './ShotCard.module.css'

interface Props {
  shot: Shot
  index: number
  onUpdate: (id: string, text: string) => void
  onDelete: (id: string) => void
  isMergeTarget?: boolean
}

export default function ShotCard({ shot, index, onUpdate, onDelete, isMergeTarget }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(shot.text)

  // Each card is both draggable (to merge it into another) and a drop target
  // (to have another merged into it). There is no reordering.
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } =
    useDraggable({ id: shot.id })
  const { setNodeRef: setDropRef } = useDroppable({ id: shot.id })

  function setNodeRef(node: HTMLElement | null) {
    setDragRef(node)
    setDropRef(node)
  }

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : undefined,
  }

  function handleConfirm() {
    const trimmed = draft.trim()
    if (trimmed) {
      onUpdate(shot.id, trimmed)
      setDraft(trimmed) // keep draft in sync with committed value
    }
    setEditing(false)
  }

  function handleCancel() {
    setDraft(shot.text)
    setEditing(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.card}${isMergeTarget ? ` ${styles.mergeTarget}` : ''}`}
    >
      {isMergeTarget && (
        <div className={styles.mergeLabel}>🔗 合体</div>
      )}
      <button
        className={styles.handle}
        {...attributes}
        {...listeners}
        aria-label="ドラッグして別のショットと合体"
      >
        ⠿
      </button>

      <div className={styles.content}>
        <span className={styles.num}>{index + 1}</span>

        {editing ? (
          <div className={styles.editArea}>
            <textarea
              className={styles.editInput}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              autoFocus
              rows={3}
            />
            <div className={styles.editActions}>
              <button className={styles.confirmBtn} onClick={handleConfirm}>
                完了
              </button>
              <button className={styles.cancelBtn} onClick={handleCancel}>
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <button
            className={styles.text}
            onClick={() => setEditing(true)}
            aria-label="タップして編集"
          >
            {shot.text}
          </button>
        )}
      </div>

      <button
        className={styles.deleteBtn}
        onClick={() => onDelete(shot.id)}
        aria-label="削除"
      >
        🗑
      </button>
    </div>
  )
}
