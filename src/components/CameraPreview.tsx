import styles from './CameraPreview.module.css'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
  onClick?: () => void
}

export default function CameraPreview({ videoRef, onClick }: Props) {
  return (
    <div className={styles.wrapper} onClick={onClick}>
      <video
        ref={videoRef}
        className={styles.video}
        playsInline
        muted
        autoPlay
      />
    </div>
  )
}
