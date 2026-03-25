import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { useScripts } from '../hooks/useScripts'
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

  // All hooks MUST be called before any conditional return (React rules of hooks)
  // Support both pointer (desktop) and touch (iPhone) drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  )

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
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
    setShots(prev => prev.filter(s => s.id !== shotId))
  }

  function handleAdd() {
    setShots(prev => [...prev, { id: generateId(), text: '新しいショット' }])
  }

  function handleSave() {
    updateScript(safeScript.id, { shots })
    navigate(`/scripts/${safeScript.id}/record`)
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
    </div>
  )
}
