import { keyMatches } from './auth.js'
import type { InboxStore } from './inboxStore.js'

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

/** The app's side of the inbox: list what arrived, and remove what was taken. */
export async function handleInboxRequest(request: Request, getStore: () => InboxStore): Promise<Response> {
  if (!keyMatches(bearer(request))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    if (request.method === 'GET') {
      const items = await getStore().list()
      return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (request.method === 'DELETE') {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
      await getStore().remove(id)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 405, headers: { Allow: 'GET, DELETE' } })
  } catch (err) {
    console.error('inbox request failed', err)
    return Response.json({ error: 'inbox unavailable' }, { status: 500 })
  }
}
