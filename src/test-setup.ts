import '@testing-library/jest-dom'

// Polyfill for URL.createObjectURL and URL.revokeObjectURL which jsdom doesn't provide
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock-url'
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {}
}
