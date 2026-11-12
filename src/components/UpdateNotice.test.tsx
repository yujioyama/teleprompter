import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import UpdateNotice from './UpdateNotice'
import { newerBuildIsOut } from '../utils/appVersion'

vi.mock('../utils/appVersion', () => ({ newerBuildIsOut: vi.fn(async () => false) }))

beforeEach(() => {
  vi.mocked(newerBuildIsOut).mockReset().mockResolvedValue(false)
})

describe('UpdateNotice', () => {
  it('stays out of the way while the running build is the latest', async () => {
    render(<UpdateNotice />)
    await waitFor(() => expect(newerBuildIsOut).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('新しいバージョンがあります')).not.toBeInTheDocument()
  })

  it('offers to update once a newer build is out', async () => {
    vi.mocked(newerBuildIsOut).mockResolvedValue(true)
    render(<UpdateNotice />)
    expect(await screen.findByText('新しいバージョンがあります')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更新する' })).toBeInTheDocument()
  })

  it('checks again when the app comes back to the foreground', async () => {
    render(<UpdateNotice />)
    await waitFor(() => expect(newerBuildIsOut).toHaveBeenCalledTimes(1))

    vi.mocked(newerBuildIsOut).mockResolvedValue(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await screen.findByText('新しいバージョンがあります')).toBeInTheDocument()
  })

  it('can be put off', async () => {
    vi.mocked(newerBuildIsOut).mockResolvedValue(true)
    render(<UpdateNotice />)
    fireEvent.click(await screen.findByRole('button', { name: 'あとで' }))
    expect(screen.queryByText('新しいバージョンがあります')).not.toBeInTheDocument()
  })
})
