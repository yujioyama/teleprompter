import { handleSubtitlesRequest } from '../server/subtitlesApi.js'
import { subtitleStoreFromEnv } from '../server/subtitleStore.js'

export function GET(request: Request) {
  return handleSubtitlesRequest(request, subtitleStoreFromEnv)
}

export function DELETE(request: Request) {
  return handleSubtitlesRequest(request, subtitleStoreFromEnv)
}
