import styles from './CameraPreview.module.css'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
}

export default function CameraPreview({ videoRef }: Props) {
  return (
    <div className={styles.wrapper}>
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
