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
  // Ref mirrors mergeTargetId state so handleDragEnd reads the latest value
  // regardless of React's render/flush timing
  const mergeTargetRef = useRef<string | null>(null)
  // Timer that fires after MERGE_HOVER_MS of hovering over the same card
  const mergeHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks which card id the dragged item is currently over
  const currentOverIdRef = useRef<string | null>(null)

  // How long (ms) to hover over a card before merge mode activates.
  // Distinct from the drag-start delay (250ms) so total deliberate action ≈ 550ms.
  const MERGE_HOVER_MS = 300

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

  function clearMergeHoverTimer() {
    if (mergeHoverTimerRef.current !== null) {
      clearTimeout(mergeHoverTimerRef.current)
      mergeHoverTimerRef.current = null
    }
  }

  // Hover-based merge detection: position calculations are unreliable because
  // dnd-kit's sortable algorithm displaces cards mid-drag, shifting over.rect.
  // Instead we detect intent by time: if the dragged card stays over the same
  // target for MERGE_HOVER_MS without moving to a different card, merge activates.
  function handleDragMove(event: DragMoveEvent) {
    const { active, over } = event

    if (!over || over.id === active.id) {
      // Not hovering over any valid target — cancel any pending merge
      clearMergeHoverTimer()
      currentOverIdRef.current = null
      mergeTargetRef.current = null
      setMergeTargetId(null)
      return
    }

    const overId = over.id as string

    if (overId !== currentOverIdRef.current) {
      // Moved to a different card — reset and start a fresh hover timer
      clearMergeHoverTimer()
      mergeTargetRef.current = null
      setMergeTargetId(null)
      currentOverIdRef.current = overId

      mergeHoverTimerRef.current = setTimeout(() => {
        mergeTargetRef.current = overId
        setMergeTargetId(overId)
        mergeHoverTimerRef.current = null
      }, MERGE_HOVER_MS)
    }
    // else: still over the same card — let the timer run (or merge is already active)
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

  function resetMergeState() {
    clearMergeHoverTimer()
    currentOverIdRef.current = null
    mergeTargetRef.current = null
    setMergeTargetId(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    // Read from ref (not state) to get the latest value regardless of React batching
    const currentMergeTarget = mergeTargetRef.current
    resetMergeState()

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
          onDragCancel={resetMergeState}
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
