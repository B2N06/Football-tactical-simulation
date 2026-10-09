// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'

describe('战术编辑器球员选择回归', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'footballApi', {
      configurable: true,
      value: {
        getDatabaseSummary: vi.fn().mockResolvedValue({ matches: 0, teams: 0, players: 0, events: 0, frames: 0, scenarios: 0 }),
        listMatches: vi.fn().mockResolvedValue([]),
        getAppInfo: vi.fn().mockResolvedValue({ version: 'test', databasePath: 'test.sqlite', platform: 'test' }),
        saveScenario: vi.fn().mockResolvedValue({ ok: true })
      }
    })
  })

  afterEach(() => cleanup())

  it('双方 22 名球员都能成为唯一的当前选中球员', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByText('战术编辑器').closest('button')!)

    const playerButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-player-id]'))
    expect(playerButtons).toHaveLength(22)

    for (const button of playerButtons) {
      const playerId = button.dataset.playerId!
      fireEvent.click(button)
      const inspector = screen.getByTestId('player-inspector')
      expect(inspector.dataset.selectedPlayerId).toBe(playerId)
      expect(inspector.getAttribute('aria-label')).toContain(button.getAttribute('aria-label')!.split('，')[0].replace('选择 ', ''))
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(container.querySelectorAll('.pitch-player.is-selected')).toHaveLength(1)
    }
  })

  it('切换球队标签时只选择该队门将，不污染之后的单个球员选择', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByText('战术编辑器').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: '客队' }))
    expect(screen.getByTestId('player-inspector').dataset.selectedPlayerId).toBe('away-1')

    const awayStriker = container.querySelector<HTMLButtonElement>('[data-player-id="away-9"]')!
    fireEvent.click(awayStriker)
    expect(screen.getByTestId('player-inspector').dataset.selectedPlayerId).toBe('away-9')
  })

  it('可撤销、重做球员职责修改，并显式保存方案', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('战术编辑器').closest('button')!)
    const duty = screen.getByText('职责').closest('label')!.querySelector('select')!
    expect(duty.value).toBe('进攻')

    fireEvent.change(duty, { target: { value: '支援' } })
    expect(duty.value).toBe('支援')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(duty.value).toBe('进攻')
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(duty.value).toBe('支援')

    fireEvent.click(screen.getByRole('button', { name: '保存方案' }))
    expect(window.footballApi.saveScenario).toHaveBeenCalled()
  })
})
