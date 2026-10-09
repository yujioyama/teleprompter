import { handleMcpRequest } from '../server/mcp.js'
import { inboxStoreFromEnv } from '../server/inboxStore.js'

// Claude chat's custom connector: https://<app>/api/mcp?key=<INBOX_SECRET>
export function POST(request: Request) {
  return handleMcpRequest(request, inboxStoreFromEnv)
}

export function GET(request: Request) {
  return handleMcpRequest(request, inboxStoreFromEnv)
}

export function DELETE(request: Request) {
  return handleMcpRequest(request, inboxStoreFromEnv)
}
