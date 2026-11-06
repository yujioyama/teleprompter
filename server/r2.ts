import { createHash, createHmac, randomUUID } from 'node:crypto'

// Videos to post go to a Cloudflare R2 bucket: the app PUTs the file straight
// to R2 with a presigned URL (so it never passes through a Vercel Function and
// its body limit), and Buffer fetches it from the bucket's public URL.

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** The bucket's public URL, e.g. https://pub-xxxx.r2.dev (no trailing slash needed). */
  publicUrl: string
}

/** The R2 settings from the environment, or null when any is missing. */
export function r2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const publicUrl = process.env.R2_PUBLIC_URL
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl: publicUrl.replace(/\/+$/, '') }
}

export interface PresignInput {
  method: 'GET' | 'PUT'
  host: string
  /** Already URI-encoded path, starting with '/'. */
  path: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  expiresSeconds: number
  now: Date
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

/** RFC 3986 encoding, as SigV4 wants it. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * An S3 SigV4 query-string presigned URL. Only `host` is signed, so the
 * uploader may send any Content-Type.
 */
export function presignUrl(input: PresignInput): string {
  const datetime = amzDate(input.now)
  const date = datetime.slice(0, 8)
  const scope = `${date}/${input.region}/s3/aws4_request`
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': datetime,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  }
  const query = Object.keys(params)
    .sort()
    .map(k => `${encode(k)}=${encode(params[k])}`)
    .join('&')
  const canonical = [input.method, input.path, query, `host:${input.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, sha256Hex(canonical)].join('\n')
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date)
  const kSigning = hmac(hmac(hmac(kDate, input.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex')
  return `https://${input.host}${input.path}?${query}&X-Amz-Signature=${signature}`
}

export interface Upload {
  /** Where the app PUTs the video (expires in 15 minutes). */
  uploadUrl: string
  /** Where Buffer fetches it from, until the bucket's lifecycle rule removes it. */
  videoUrl: string
}

/** A fresh object key under posts/ with a URL to upload it to and its public URL. */
export function newVideoUpload(config: R2Config, now = new Date()): Upload {
  const key = `posts/${now.toISOString().slice(0, 10)}/${randomUUID()}.mp4`
  const uploadUrl = presignUrl({
    method: 'PUT',
    host: `${config.accountId}.r2.cloudflarestorage.com`,
    path: `/${encode(config.bucket)}/${key.split('/').map(encode).join('/')}`,
    region: 'auto',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresSeconds: 15 * 60,
    now,
  })
  return { uploadUrl, videoUrl: `${config.publicUrl}/${key}` }
}
