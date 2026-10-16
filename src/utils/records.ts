import type { VideoRecord } from '../../shared/videoRecord'

// The record of how a saved video was made (api/records.ts), read back by
// Claude through the connector for the weekly analysis.
export async function postVideoRecord(key: string, record: VideoRecord): Promise<void> {
  const res = await fetch('/api/records', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  })
  if (!res.ok) throw new Error(`Record request failed: ${res.status}`)
}
