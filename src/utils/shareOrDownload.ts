function getExtension(mimeType: string): string {
  if (mimeType === 'application/json') return 'json'
  if (mimeType === 'image/png') return 'png'
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

export interface ShareItem {
  blob: Blob
  filenameBase: string
}

/**
 * Share a finished video (or a script backup) via the Web Share API (saves to camera roll on iOS
 * Safari 15+), falling back to a plain download when sharing isn't
 * available. Returns false only when the user explicitly cancelled the
 * native share sheet, so callers can distinguish "cancelled" from "saved".
 */
export async function shareOrDownload(blob: Blob, filenameBase: string): Promise<boolean> {
  return shareAllOrDownload([{ blob, filenameBase }])
}

/**
 * Like shareOrDownload, but all the files go in one share sheet, so iOS
 * saves them to the camera roll with a single "Save N Items". Without
 * sharing, each one is downloaded.
 */
export async function shareAllOrDownload(items: ShareItem[]): Promise<boolean> {
  const files = items.map(({ blob, filenameBase }) => {
    const fullName = `${filenameBase}.${getExtension(blob.type)}`
    return new File([blob], fullName, { type: blob.type || 'video/webm' })
  })

  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share(files.length === 1 ? { files, title: files[0].name } : { files })
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false
      // Non-AbortError: share API failed for other reason — fall through to download fallback
    }
  }

  for (const file of files) {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }
  return true
}
