import { afterEach, describe, expect, it, vi } from 'vitest'
import { entryScriptOf, newerBuildIsOut } from './appVersion'

const page = (src: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script></head><body><script>register()</script></body></html>`

function runBuild(src: string) {
  const script = document.createElement('script')
  script.type = 'module'
  script.setAttribute('src', src)
  document.head.append(script)
}

function serve(html: string, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({ ok, text: async () => html }) as unknown as typeof fetch
}

afterEach(() => {
  document.head.innerHTML = ''
})

describe('entryScriptOf', () => {
  it('reads the entry script of a built page', () => {
    expect(entryScriptOf(page('/assets/index-AbC123.js'))).toBe('/assets/index-AbC123.js')
  })

  it('finds none in a page that is not the app', () => {
    expect(entryScriptOf('<html><body>Not found</body></html>')).toBeNull()
  })
})

describe('newerBuildIsOut', () => {
  it('says so when the server has another build', async () => {
    runBuild('/assets/index-old.js')
    serve(page('/assets/index-new.js'))
    expect(await newerBuildIsOut()).toBe(true)
    expect(fetch).toHaveBeenCalledWith('/index.html', { cache: 'no-store' })
  })

  it('says nothing while the running build is the latest', async () => {
    runBuild('/assets/index-same.js')
    serve(page('/assets/index-same.js'))
    expect(await newerBuildIsOut()).toBe(false)
  })

  it('says nothing when it cannot tell', async () => {
    runBuild('/assets/index-old.js')
    serve('<html>error</html>')
    expect(await newerBuildIsOut()).toBe(false)
    serve(page('/assets/index-new.js'), false)
    expect(await newerBuildIsOut()).toBe(false)
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    expect(await newerBuildIsOut()).toBe(false)
  })
})
