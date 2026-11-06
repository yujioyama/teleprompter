import { createBufferClient } from '../server/buffer.js'
import { handlePostRequest } from '../server/postApi.js'
import { qstashConfigFromEnv } from '../server/qstash.js'
import { r2ConfigFromEnv } from '../server/r2.js'
import { threadsConfigFromEnv } from '../server/threads.js'

export function POST(request: Request) {
  return handlePostRequest(request, {
    r2: r2ConfigFromEnv,
    buffer: () => (process.env.BUFFER_API_KEY ? createBufferClient(process.env.BUFFER_API_KEY.trim()) : null),
    threads: () => (threadsConfigFromEnv() ? qstashConfigFromEnv() : null),
  })
}
