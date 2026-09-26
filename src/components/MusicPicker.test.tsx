import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MusicPicker from './MusicPicker'
import { MusicTrack } from '../data/musicTracks'

const TRACKS: MusicTrack[] = [
  { id: 'lofi-1', title: 'Lofi One', genre: 'lofi', credit: 'a', file: 'music/lofi-1.mp3' },
  { id: 'pop-1', title: 'Pop One', genre: 'pop', credit: 'b', file: 'music/pop-1.mp3' },
]

describe('MusicPicker genre select', () => {
  it('defaults to the first genre with tracks and shows only its tracks', () => {
    render(
      <MusicPicker tracks={TRACKS} selectedId={null} onSelect={vi.fn()} volume={0.3} onVolumeChange={vi.fn()} />
    )
    expect(screen.getByText('Lofi One')).toBeInTheDocument()
    expect(screen.queryByText('Pop One')).not.toBeInTheDocument()
  })

  it('switches the visible track list when a different genre is selected', () => {
    render(
      <MusicPicker tracks={TRACKS} selectedId={null} onSelect={vi.fn()} volume={0.3} onVolumeChange={vi.fn()} />
    )
    fireEvent.change(screen.getByLabelText('ジャンル'), { target: { value: 'pop' } })
    expect(screen.getByText('Pop One')).toBeInTheDocument()
    expect(screen.queryByText('Lofi One')).not.toBeInTheDocument()
  })

  it('clears the current selection when the genre changes', () => {
    const onSelect = vi.fn()
    render(
      <MusicPicker tracks={TRACKS} selectedId="lofi-1" onSelect={onSelect} volume={0.3} onVolumeChange={vi.fn()} />
    )
    fireEvent.change(screen.getByLabelText('ジャンル'), { target: { value: 'pop' } })
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
