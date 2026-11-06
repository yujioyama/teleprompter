import { createBufferClient } from '../server/buffer.js'
import { handlePostRequest } from '../server/postApi.js'
import { r2ConfigFromEnv } from '../server/r2.js'

export function POST(request: Request) {
  return handlePostRequest(request, {
    r2: r2ConfigFromEnv,
    buffer: () => (process.env.BUFFER_API_KEY ? createBufferClient(process.env.BUFFER_API_KEY) : null),
  })
}
