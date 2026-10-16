import { handleRecordsRequest } from '../server/recordsApi.js'
import { recordStoreFromEnv } from '../server/recordStore.js'

export function POST(request: Request) {
  return handleRecordsRequest(request, recordStoreFromEnv)
}
