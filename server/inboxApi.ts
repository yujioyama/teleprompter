import { requiredId, withAuthedJson } from './http.js'
import type { InboxStore } from './inboxStore.js'

/** The app's side of the inbox: list what arrived, and remove what was taken. */
export function handleInboxRequest(request: Request, getStore: () => InboxStore): Promise<Response> {
  return withAuthedJson(request, 'inbox', async () => {
    if (request.method === 'GET') {
      const items = await getStore().list()
      return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (request.method === 'DELETE') {
      const id = requiredId(request)
      if (id instanceof Response) return id
      await getStore().remove(id)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 405, headers: { Allow: 'GET, DELETE' } })
  })
}
