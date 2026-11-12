import { qstashConfigFromEnv } from '../server/qstash.js'
import { redisFromEnv } from '../server/redis.js'
import { threadsConfigFromEnv } from '../server/threads.js'
import { handleThreadsJob } from '../server/threadsJobApi.js'

// Called by QStash only (signed): the Threads steps of 投稿する.
export function POST(request: Request) {
  return handleThreadsJob(request, { qstash: qstashConfigFromEnv, threads: threadsConfigFromEnv, redis: redisFromEnv })
}
