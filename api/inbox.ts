import { handleInboxRequest } from '../server/inboxApi.js'
import { inboxStoreFromEnv } from '../server/inboxStore.js'

export function GET(request: Request) {
  return handleInboxRequest(request, inboxStoreFromEnv)
}

export function DELETE(request: Request) {
  return handleInboxRequest(request, inboxStoreFromEnv)
}
