function getExtension(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

/**
 * Share a finished video via the Web Share API (saves to camera roll on iOS
 * Safari 15+), falling back to a plain download when sharing isn't
 * available. Returns false only when the user explicitly cancelled the
 * native share sheet, so callers can distinguish "cancelled" from "saved".
 */
export async function shareOrDownload(blob: Blob, filenameBase: string): Promise<boolean> {
  const ext = getExtension(blob.type)
  const fullName = `${filenameBase}.${ext}`
  const file = new File([blob], fullName, { type: blob.type || 'video/webm' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fullName })
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false
      // Non-AbortError: share API failed for other reason — fall through to download fallback
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fullName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
  return true
}
