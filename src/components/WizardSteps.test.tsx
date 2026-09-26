import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WizardSteps from './WizardSteps'

describe('WizardSteps', () => {
  it('shows a checkmark on completed steps and highlights the current one', () => {
    render(<WizardSteps current="bgm" completed={['trim', 'subtitle']} onSelect={vi.fn()} />)
    const bgmStep = screen.getByText('BGM').closest('button')!
    expect(bgmStep).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('トリミング').closest('button')).toHaveTextContent('✓')
  })

  it('navigates back when a completed step is clicked', () => {
    const onSelect = vi.fn()
    render(<WizardSteps current="bgm" completed={['trim', 'subtitle']} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('字幕'))
    expect(onSelect).toHaveBeenCalledWith('subtitle')
  })

  it('does nothing when a not-yet-completed step is clicked', () => {
    const onSelect = vi.fn()
    render(<WizardSteps current="trim" completed={[]} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('書き出し'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('disables every step, including completed ones, when disabled is true', () => {
    const onSelect = vi.fn()
    render(
      <WizardSteps current="bgm" completed={['trim', 'subtitle']} onSelect={onSelect} disabled />
    )
    const trimStep = screen.getByText('トリミング').closest('button')!
    const subtitleStep = screen.getByText('字幕').closest('button')!
    expect(trimStep).toBeDisabled()
    expect(subtitleStep).toBeDisabled()

    fireEvent.click(trimStep)
    fireEvent.click(subtitleStep)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
