import { useEffect } from 'react'
import styles from './VideoReviewModal.module.css'

interface Props {
  url: string
  onClose: () => void
}

export default function VideoReviewModal({ url, onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="録画レビュー"
      >
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="閉じる"
        >
          ✕
        </button>
        <video
          className={styles.video}
          src={url}
          controls
          playsInline
          preload="auto"
        />
      </div>
    </div>
  )
}
