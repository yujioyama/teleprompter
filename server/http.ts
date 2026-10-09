import { keyMatches } from './auth.js'

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

/**
 * The app-facing endpoints' shared frame: reject a wrong key with 401, and
 * turn anything the handler throws (an unconfigured store, Redis down) into
 * a logged 500.
 */
export async function withAuthedJson(
  request: Request,
  name: string,
  handle: () => Promise<Response>,
): Promise<Response> {
  if (!keyMatches(bearer(request))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    return await handle()
  } catch (err) {
    console.error(`${name} request failed`, err)
    return Response.json({ error: `${name} unavailable` }, { status: 500 })
  }
}

/** The `id` query parameter, or a 400 response when it is missing. */
export function requiredId(request: Request): string | Response {
  const id = new URL(request.url).searchParams.get('id')
  return id || Response.json({ error: 'id is required' }, { status: 400 })
}
