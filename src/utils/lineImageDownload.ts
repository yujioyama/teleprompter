import type { InboxItem } from '../../shared/inbox'
import type { Script } from '../types'
import { listLineImageIds, pruneLineImages, saveLineImage } from './lineImageStore'
import type { StoredLineImage } from './lineImages'

/** Plenty for the slots it is shown in; a full-size photo would decode to more than an iPhone gives the page. */
const MAX_SIDE = 1280
const JPEG_QUALITY = 0.9

/**
 * An image's bytes: straight from its site when that allows it (Wikimedia
 * does), else through our own endpoint, which needs the inbox key.
 */
async function fetchImageBytes(url: string, inboxKey: string | undefined): Promise<Blob> {
  try {
    const direct = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (direct.ok) return await direct.blob()
  } catch {
    // Blocked by CORS, or the network: the endpoint settles which.
  }
  if (!inboxKey) throw new Error('この画像は受け取りキーがないと取得できません')
  const res = await fetch(`/api/image?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${inboxKey}` } })
  if (!res.ok) throw new Error(`画像を取得できませんでした (${res.status})`)
  return res.blob()
}

/** The image at most MAX_SIDE on its long side, with its size. One small enough is kept as it came. */
export async function shrinkImage(blob: Blob): Promise<Omit<StoredLineImage, 'id'>> {
  const bitmap = await createImageBitmap(blob)
  try {
    const { width, height } = bitmap
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
    if (scale === 1) return { blob, width, height }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    // Only a PNG may have see-through parts worth keeping.
    const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const small = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, JPEG_QUALITY))
    const size = { width: canvas.width, height: canvas.height }
    canvas.width = 0
    canvas.height = 0
    if (!small) throw new Error('画像を縮小できませんでした')
    return { blob: small, ...size }
  } finally {
    bitmap.close()
  }
}

/** Download an image and keep it on this device under `id` (its URL unless told otherwise). */
export async function downloadLineImage(url: string, inboxKey: string | undefined, id = url): Promise<void> {
  const image = await shrinkImage(await fetchImageBytes(url, inboxKey))
  await saveLineImage({ id, ...image })
}

/** A picture chosen on this device, kept under a new id. */
export async function saveChosenImage(file: Blob): Promise<string> {
  const id = crypto.randomUUID()
  await saveLineImage({ id, ...(await shrinkImage(file)) })
  return id
}

/**
 * Get every image of `wanted` this device doesn't have yet, one at a time
 * (each is decoded to be shrunk). Resolves to the URLs that failed; never
 * throws, so a script still opens and films without its images.
 */
export async function ensureLineImages(wanted: { imageId: string; url?: string }[], inboxKey: string | undefined): Promise<string[]> {
  const failed: string[] = []
  let have: Set<string>
  try {
    have = await listLineImageIds()
  } catch (err) {
    console.warn('Could not read the stored images', err)
    return wanted.flatMap(w => (w.url ? [w.url] : []))
  }
  for (const { imageId, url } of wanted) {
    if (!url || have.has(imageId)) continue
    have.add(imageId)
    try {
      await downloadLineImage(url, inboxKey, imageId)
    } catch (err) {
      console.warn('Could not download an image', url, err)
      failed.push(url)
    }
  }
  return failed
}

/**
 * What the inbox holds right now: get its images, and let go of any that
 * neither it nor a script refers to any more (a thrown-away item's).
 */
export async function receiveInboxImages(
  items: Pick<InboxItem, 'images'>[],
  scripts: Pick<Script, 'lineImages'>[],
  inboxKey: string,
): Promise<void> {
  const waiting = items.flatMap(item => item.images ?? []).map(({ url }) => ({ imageId: url, url }))
  const kept = scripts.flatMap(script => script.lineImages ?? []).map(image => image.imageId)
  try {
    await pruneLineImages(new Set([...kept, ...waiting.map(image => image.imageId)]))
  } catch (err) {
    console.warn('Could not clear the stored images', err)
  }
  await ensureLineImages(waiting, inboxKey)
}
