import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
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

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: shot.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
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
        aria-label="並び替え"
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
