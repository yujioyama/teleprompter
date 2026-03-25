import { useEffect, useRef, useState } from 'react'

interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>
  error: string | null
  ready: boolean
}

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user', // front camera
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: true,
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setReady(true)
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setError('カメラのアクセスが拒否されました。設定から許可してください。')
        } else {
          setError('カメラを起動できませんでした。')
        }
      }
    }

    startCamera()

    return () => {
      stream?.getTracks().forEach(track => track.stop())
      setReady(false)
    }
  }, [])

  return { videoRef, error, ready }
}
