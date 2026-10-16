import { handleMcpRequest, type McpDeps } from '../server/mcp.js'
import { inboxStoreFromEnv } from '../server/inboxStore.js'
import { subtitleStoreFromEnv } from '../server/subtitleStore.js'
import { recordStoreFromEnv } from '../server/recordStore.js'

const deps: McpDeps = { inbox: inboxStoreFromEnv, subtitles: subtitleStoreFromEnv, records: recordStoreFromEnv }

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
