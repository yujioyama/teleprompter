import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CoverFrameSettings from './CoverFrameSettings'

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:thumb')
  URL.revokeObjectURL = vi.fn()
})

describe('CoverFrameSettings', () => {
  it('offers なし, 最初 and 最後, and 1 to 5 frames', () => {
    render(<CoverFrameSettings source="picked" madeCover={null} image={null} onImageChange={vi.fn()} placement="first" count={2} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '最初' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'なし' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['1コマ', '2コマ', '3コマ', '4コマ', '5コマ'])
    expect(screen.getByLabelText('コマ数')).toHaveValue('2')
  })

  it('reports a change of place or frame count', () => {
    const onChange = vi.fn()
    render(<CoverFrameSettings source="picked" madeCover={null} image={null} onImageChange={vi.fn()} placement="first" count={1} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '最後' }))
    expect(onChange).toHaveBeenLastCalledWith({ coverFramePlacement: 'last' })
    fireEvent.change(screen.getByLabelText('コマ数'), { target: { value: '4' } })
    expect(onChange).toHaveBeenLastCalledWith({ coverFrameCount: 4 })
  })

  it('has no frame count to pick for なし', () => {
    render(<CoverFrameSettings source="picked" madeCover={null} image={null} onImageChange={vi.fn()} placement="none" count={1} onChange={vi.fn()} />)
    expect(screen.getByLabelText('コマ数')).toBeDisabled()
  })

  it('switches between the made cover and a picked image', () => {
    const onChange = vi.fn()
    render(<CoverFrameSettings source="made" madeCover={null} image={null} onImageChange={vi.fn()} placement="first" count={1} onChange={onChange} />)
    expect(screen.getByRole('button', { name: '作ったカバー' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '選んだ画像' }))
    expect(onChange).toHaveBeenLastCalledWith({ coverFrameSource: 'picked' })
  })

  it('points to カバー画像を作る until the cover has been made, then shows it', () => {
    const props = { source: 'made' as const, image: null, onImageChange: vi.fn(), placement: 'first' as const, count: 1, onChange: vi.fn() }
    const { rerender } = render(<CoverFrameSettings {...props} madeCover={null} />)
    expect(screen.getByText(/を開くと、そのカバーが入ります/)).toBeInTheDocument()
    expect(screen.queryByLabelText('カバー画像')).not.toBeInTheDocument()

    rerender(<CoverFrameSettings {...props} madeCover={new Blob(['png'], { type: 'image/png' })} />)
    expect(screen.getByAltText('作ったカバー')).toBeInTheDocument()
  })

  it('takes a picked image, shows it, and lets it be taken off', () => {
    const onImageChange = vi.fn()
    const image = new File(['png'], 'cover.png', { type: 'image/png' })
    const { rerender } = render(
      <CoverFrameSettings source="picked" madeCover={null} image={null} onImageChange={onImageChange} placement="first" count={1} onChange={vi.fn()} />,
    )
    fireEvent.change(screen.getByLabelText('カバー画像'), { target: { files: [image] } })
    expect(onImageChange).toHaveBeenLastCalledWith(image)

    rerender(<CoverFrameSettings source="picked" madeCover={null} image={image} onImageChange={onImageChange} placement="first" count={1} onChange={vi.fn()} />)
    expect(screen.getByAltText('選んだカバー画像')).toBeInTheDocument()
    fireEvent.click(screen.getByText('外す'))
    expect(onImageChange).toHaveBeenLastCalledWith(null)
  })
})
