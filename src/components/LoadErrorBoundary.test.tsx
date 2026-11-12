import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoadErrorBoundary from './LoadErrorBoundary'

function Broken(): never {
  throw new Error('Failed to fetch dynamically imported module')
}

describe('LoadErrorBoundary', () => {
  it('shows the screen when it loads', () => {
    render(<LoadErrorBoundary><p>ok</p></LoadErrorBoundary>)
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('offers a reload instead of a blank page when a screen fails to load', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<LoadErrorBoundary><Broken /></LoadErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('画面を読み込めませんでした')
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
  })
})
