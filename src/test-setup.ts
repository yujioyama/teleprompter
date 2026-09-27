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
