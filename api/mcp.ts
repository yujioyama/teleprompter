import { handleMcpRequest, type McpDeps } from '../server/mcp.js'
import { inboxStoreFromEnv } from '../server/inboxStore.js'
import { subtitleStoreFromEnv } from '../server/subtitleStore.js'

const deps: McpDeps = { inbox: inboxStoreFromEnv, subtitles: subtitleStoreFromEnv }

// Claude chat's custom connector: https://<app>/api/mcp?key=<INBOX_SECRET>
export function POST(request: Request) {
  return handleMcpRequest(request, deps)
}

export function GET(request: Request) {
  return handleMcpRequest(request, deps)
}

export function DELETE(request: Request) {
  return handleMcpRequest(request, deps)
}
