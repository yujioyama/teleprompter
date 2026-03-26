import { useEffect, useRef, useState } from 'react'

interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>
  error: string | null
  ready: boolean
  restart: () => Promise<void>
}

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  async function startCamera() {
    // Stop existing tracks before re-initializing
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setReady(false)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user', // front camera
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setReady(true)
        setError(null)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('カメラのアクセスが拒否されました。設定から許可してください。')
      } else {
        setError('カメラを起動できませんでした。')
      }
    }
  }

  useEffect(() => {
    startCamera()
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop())
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { videoRef, error, ready, restart: startCamera }
}
