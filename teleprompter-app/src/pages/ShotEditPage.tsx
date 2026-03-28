import { useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragMoveEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { useScripts } from '../hooks/useScripts'
import { computeMergedText } from '../utils/mergeShots'
import { Shot } from '../types'
import ShotCard from '../components/ShotCard'
import styles from './ShotEditPage.module.css'

function generateId() {
  return crypto.randomUUID()
}

export default function ShotEditPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript, updateScript } = useScripts()

  const script = id ? getScript(id) : undefined

  const [shots, setShots] = useState<Shot[]>(script?.shots ?? [])
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
  const [lastMergeSnapshot, setLastMergeSnapshot] = useState<Shot[] | null>(null)
  const [undoVisible, setUndoVisible] = useState(false)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref mirrors mergeTargetId state so handleDragEnd always reads the latest value
  // even if React hasn't flushed the setState from onDragMove yet
  const mergeTargetRef = useRef<string | null>(null)

  // All hooks MUST be called before any conditional return (React rules of hooks)
  // Support both pointer (desktop) and touch (iPhone) drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  )

  function clearUndoTimer() {
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
  }

  // onDragMove fires on every pointer/touch movement (unlike onDragOver which only
  // fires when the "over" target changes). We need continuous updates to detect
  // when the dragged card's center enters the middle zone of another card.
  function handleDragMove(event: DragMoveEvent) {
    const { active, over } = event
    if (!over || over.id === active.id) {
      mergeTargetRef.current = null
      setMergeTargetId(null)
      return
    }
    const translated = active.rect.current.translated
    if (!translated) {
      mergeTargetRef.current = null
      setMergeTargetId(null)
      return
    }
    const dragCenterY = translated.top + translated.height / 2
    const targetRect = over.rect
    const relativeY = (dragCenterY - targetRect.top) / targetRect.height
    const newTarget = (relativeY > 0.3 && relativeY < 0.7) ? (over.id as string) : null
    mergeTargetRef.current = newTarget
    setMergeTargetId(newTarget)
  }

  // Early return AFTER all hooks
  if (!script) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        スクリプトが見つかりません
      </div>
    )
  }

  // Capture narrowed script reference for use in inner functions
  const safeScript = script

  function mergeShots(activeId: string, targetId: string) {
    const activeIndex = shots.findIndex(s => s.id === activeId)
    const targetIndex = shots.findIndex(s => s.id === targetId)
    if (activeIndex === -1 || targetIndex === -1) return

    const mergedText = computeMergedText(
      activeIndex,
      targetIndex,
      shots[activeIndex].text,
      shots[targetIndex].text,
    )
    const next = shots
      .filter(s => s.id !== activeId)
      .map(s => s.id === targetId ? { ...s, text: mergedText } : s)

    setLastMergeSnapshot([...shots])
    setShots(next)
    updateScript(safeScript.id, { shots: next })

    clearUndoTimer()
    setUndoVisible(true)
    undoTimerRef.current = setTimeout(() => {
      setUndoVisible(false)
      setLastMergeSnapshot(null)
      undoTimerRef.current = null
    }, 5000)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    // Read from ref (not state) to get the latest value regardless of React batching
    const currentMergeTarget = mergeTargetRef.current
    mergeTargetRef.current = null
    setMergeTargetId(null)

    if (!over || active.id === over.id) return

    if (currentMergeTarget && currentMergeTarget === over.id) {
      mergeShots(active.id as string, currentMergeTarget)
      return
    }

    setShots(prev => {
      const oldIndex = prev.findIndex(s => s.id === active.id)
      const newIndex = prev.findIndex(s => s.id === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  function handleUpdate(shotId: string, text: string) {
    setShots(prev => prev.map(s => (s.id === shotId ? { ...s, text } : s)))
  }

  function handleDelete(shotId: string) {
    clearUndoTimer()
    setUndoVisible(false)
    setShots(prev => prev.filter(s => s.id !== shotId))
  }

  function handleAdd() {
    clearUndoTimer()
    setUndoVisible(false)
    setShots(prev => [...prev, { id: generateId(), text: '新しいショット' }])
  }

  function handleSave() {
    updateScript(safeScript.id, { shots })
    navigate(`/scripts/${safeScript.id}/record`)
  }

  function handleUndo() {
    if (!lastMergeSnapshot) return
    clearUndoTimer()
    setShots(lastMergeSnapshot)
    updateScript(safeScript.id, { shots: lastMergeSnapshot })
    setUndoVisible(false)
    setLastMergeSnapshot(null)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => navigate(`/scripts/${safeScript.id}/edit`)}
        >
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>{safeScript.title}</h1>
      </header>

      <div className={styles.body}>
        <p className={styles.hint}>
          タップ → 編集　長押し → 並び替え ({shots.length}ショット)
        </p>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={shots.map(s => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className={styles.list}>
              {shots.map((shot, i) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  index={i}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  isMergeTarget={mergeTargetId === shot.id}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <button className={styles.addBtn} onClick={handleAdd}>
          ＋ ショット追加
        </button>
      </div>

      <div className={styles.footer}>
        <button className={styles.recordBtn} onClick={handleSave}>
          🎬 撮影開始
        </button>
      </div>

      {undoVisible && (
        <div className={styles.undoToast}>
          <span>ショットを合体しました</span>
          <button className={styles.undoBtn} onClick={handleUndo}>
            元に戻す
          </button>
        </div>
      )}
    </div>
  )
}
