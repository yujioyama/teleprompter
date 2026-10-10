import { requiredId, withAuthedJson } from './http.js'
import type { SubtitleStore } from './subtitleStore.js'

/** The subtitle step's side: pick up Claude's lines for a request, then clear them. */
export function handleSubtitlesRequest(request: Request, getStore: () => SubtitleStore): Promise<Response> {
  return withAuthedJson(request, 'subtitles', async () => {
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, DELETE' } })
    }
    const id = requiredId(request)
    if (id instanceof Response) return id
    if (request.method === 'GET') {
      const lines = await getStore().get(id)
      if (!lines) return Response.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
      return Response.json({ lines }, { headers: { 'Cache-Control': 'no-store' } })
    }
    await getStore().remove(id)
    return new Response(null, { status: 204 })
  })
}
