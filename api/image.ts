import { handleImageRequest } from '../server/imageApi.js'

export function GET(request: Request) {
  return handleImageRequest(request)
}
