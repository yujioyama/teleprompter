import styles from './VideoReviewModal.module.css'

interface Props {
  url: string
  onClose: () => void
}

export default function VideoReviewModal({ url, onClose }: Props) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        <video
          className={styles.video}
          src={url}
          controls
          playsInline
        />
      </div>
    </div>
  )
}
