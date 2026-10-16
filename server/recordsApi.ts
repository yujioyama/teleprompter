import { parseVideoRecord } from '../shared/videoRecord.js'
import { withAuthedJson } from './http.js'
import type { RecordStore } from './recordStore.js'

/** The export step's side: keep a record of how the saved video was made. */
export function handleRecordsRequest(request: Request, getStore: () => RecordStore): Promise<Response> {
  return withAuthedJson(request, 'records', async () => {
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    }
    const record = parseVideoRecord(await request.json().catch(() => null))
    if (!record) return Response.json({ error: 'not a video record' }, { status: 400 })
    await getStore().put(record)
    return new Response(null, { status: 204 })
  })
}
