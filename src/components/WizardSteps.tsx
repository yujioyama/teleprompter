import styles from './WizardSteps.module.css'

export type WizardStepId = 'trim' | 'subtitle' | 'bgm' | 'export'

interface WizardStepsProps {
  current: WizardStepId
  completed: WizardStepId[]
  onSelect: (step: WizardStepId) => void
}

const STEPS: { id: WizardStepId; label: string }[] = [
  { id: 'trim', label: 'トリミング' },
  { id: 'subtitle', label: '字幕' },
  { id: 'bgm', label: 'BGM' },
  { id: 'export', label: '書き出し' },
]

export default function WizardSteps({ current, completed, onSelect }: WizardStepsProps) {
  return (
    <div className={styles.wrapper}>
      {STEPS.map(step => {
        const isCurrent = step.id === current
        const isDone = completed.includes(step.id)
        return (
          <button
            key={step.id}
            type="button"
            className={`${styles.step} ${isCurrent ? styles.stepCurrent : ''} ${isDone ? styles.stepDone : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
            onClick={() => isDone && onSelect(step.id)}
            disabled={!isDone}
          >
            <span className={styles.dot}>{isDone ? '✓' : ''}</span>
            <span className={styles.label}>{step.label}</span>
          </button>
        )
      })}
    </div>
  )
}
