import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { FinalizeTimings } from './FinalizeTimings'
import { clearTimings, recordEncode } from '../utils/finalizeTimings'

beforeEach(() => clearTimings())

describe('FinalizeTimings', () => {
  it('shows nothing until something is timed, then the log', () => {
    const { container } = render(<FinalizeTimings />)
    expect(container).toBeEmptyDOMElement()
    act(() => recordEncode({ kind: 'burn', shotId: 's1', background: false, ms: 1500, heldMs: 0, seconds: 3, ok: true }))
    expect(screen.getByText('処理時間の記録（1件）')).toBeInTheDocument()
    expect(screen.getByText(/エンコード\[burn\] s1 待ち 1\.5s/)).toBeInTheDocument()
  })

  it('消す empties it', () => {
    recordEncode({ kind: 'burn', shotId: 's1', background: false, ms: 1500, heldMs: 0, seconds: 3, ok: true })
    const { container } = render(<FinalizeTimings />)
    act(() => screen.getByRole('button', { name: '消す' }).click())
    expect(container).toBeEmptyDOMElement()
  })
})
