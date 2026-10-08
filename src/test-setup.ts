import '@testing-library/jest-dom'

// Polyfill for URL.createObjectURL and URL.revokeObjectURL which jsdom doesn't provide
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock-url'
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {}
}

// jsdom doesn't implement media playback; components release players with
// pause()/load() (see releaseVideo), which would otherwise log "Not implemented".
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.pause = () => {}
  HTMLMediaElement.prototype.load = () => {}
}

// jsdom's Blob has no text(); real browsers (iOS Safari 14+) do.
if (typeof Blob !== 'undefined' && !Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsText(this)
    })
  }
}
