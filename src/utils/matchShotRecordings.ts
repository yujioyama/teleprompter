import { Shot } from '../types'

// teleprompter-cam names saved Photos assets like:
//   TeleprompterCam-<sessionTag>-shot<paddedIndex>of<count>-<shot.id>.mov
// where <shot.id> is a crypto.randomUUID() string. This pulls that UUID
// back out so a batch of camera-roll files can be matched to shots.
const SHOT_ID_PATTERN =
  /-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.[^./]+$/

export function extractShotId(filename: string): string | null {
  const match = SHOT_ID_PATTERN.exec(filename)
  return match ? match[1] : null
}

export type ImportResolution =
  | { kind: 'legacy'; file: File }
  | { kind: 'bulk'; targets: { shot: Shot; file: File }[] }
  | { kind: 'error'; unmatchedFilenames: string[] }

export function resolveImportTargets(files: File[], shots: Shot[]): ImportResolution {
  const byId = new Map(shots.map(shot => [shot.id, shot]))

  if (files.length === 1) {
    const id = extractShotId(files[0].name)
    const shot = id ? byId.get(id) : undefined
    if (!shot) {
      return { kind: 'legacy', file: files[0] }
    }
    return { kind: 'bulk', targets: [{ shot, file: files[0] }] }
  }

  const unmatchedFilenames: string[] = []
  const targetsByShotId = new Map<string, { shot: Shot; file: File }>()

  for (const file of files) {
    const id = extractShotId(file.name)
    const shot = id ? byId.get(id) : undefined
    if (!shot) {
      unmatchedFilenames.push(file.name)
      continue
    }
    // Last file for a given shot wins (e.g. a retake recorded twice in the same session).
    targetsByShotId.set(shot.id, { shot, file })
  }

  if (unmatchedFilenames.length > 0) {
    return { kind: 'error', unmatchedFilenames }
  }

  return { kind: 'bulk', targets: [...targetsByShotId.values()] }
}
