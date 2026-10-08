import { useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core'
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
  // The shots from before the last merge or delete, and what the toast
  // offering to put them back says.
  const [undo, setUndo] = useState<{ snapshot: Shot[]; message: string } | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Cards never move out of the way (no reordering), so whichever card is
  // under the finger is the one the dragged shot will merge into on drop.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    setMergeTargetId(over && over.id !== active.id ? (over.id as string) : null)
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

  // Every change is saved as it's made, so leaving by 戻る (or the app
  // being closed) never drops edits that 撮影開始 would have saved.
  function commit(next: Shot[]) {
    setShots(next)
    updateScript(safeScript.id, { shots: next })
  }

  // Changes from here on can't be undone by the toast's snapshot, so it goes.
  function dismissUndo() {
    clearUndoTimer()
    setUndo(null)
  }

  function commitUndoable(next: Shot[], message: string) {
    commit(next)
    clearUndoTimer()
    setUndo({ snapshot: shots, message })
    undoTimerRef.current = setTimeout(() => {
      setUndo(null)
      undoTimerRef.current = null
    }, 5000)
  }

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

    commitUndoable(next, 'ショットを合体しました')
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setMergeTargetId(null)

    if (!over || active.id === over.id) return
    mergeShots(active.id as string, over.id as string)
  }

  function handleUpdate(shotId: string, text: string) {
    if (shots.find(s => s.id === shotId)?.text === text) return
    dismissUndo()
    commit(shots.map(s => (s.id === shotId ? { ...s, text } : s)))
  }

  function handleDelete(shotId: string) {
    commitUndoable(shots.filter(s => s.id !== shotId), 'ショットを削除しました')
  }

  function handleAdd() {
    dismissUndo()
    commit([...shots, { id: generateId(), text: '新しいショット' }])
  }

  function handleSave() {
    // Jump straight to the native Cinematic-capture companion app
    // (github.com/yujioyama/teleprompter-cam) instead of making the user
    // press a second "record" button on the next screen.
    const payload = encodeURIComponent(JSON.stringify(shots))
    window.location.href = `teleprompter-cam://record?shots=${payload}`
    navigate(`/scripts/${safeScript.id}/record`)
  }

  function handleUndo() {
    if (!undo) return
    commit(undo.snapshot)
    dismissUndo()
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
          {/* eslint-disable-next-line no-irregular-whitespace -- full-width space is intentional Japanese UI spacing */}
          タップ → 編集　長押しで重ねる → 合体 ({shots.length}ショット)
        </p>

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setMergeTargetId(null)}
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

      {undo && (
        <div className={styles.undoToast}>
          <span>{undo.message}</span>
          <button className={styles.undoBtn} onClick={handleUndo}>
            元に戻す
          </button>
        </div>
      )}
    </div>
  )
}
