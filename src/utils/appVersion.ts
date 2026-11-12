/**
 * The build an index.html loads: the src of its entry script, whose name
 * carries the build's hash. Null when it has none (not this app's page).
 */
export function entryScriptOf(html: string): string | null {
  const tag = html.match(/<script\b[^>]*\btype="module"[^>]*>/g)?.find(t => /\bsrc="/.test(t))
  return tag?.match(/\bsrc="([^"]+)"/)?.[1] ?? null
}

/** The build this page is running. */
export function runningEntryScript(): string | null {
  return document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null
}

/**
 * Whether the server now has another build than the one running. False
 * whenever that can't be told (offline, an unexpected answer): only a build
 * that's really there is worth interrupting for.
 */
export async function newerBuildIsOut(): Promise<boolean> {
  const running = runningEntryScript()
  if (!running) return false
  try {
    const response = await fetch('/index.html', { cache: 'no-store' })
    if (!response.ok) return false
    const latest = entryScriptOf(await response.text())
    return latest !== null && latest !== running
  } catch {
    return false
  }
}
