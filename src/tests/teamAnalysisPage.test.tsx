// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamAnalysisPage } from '../components/TeamAnalysisPage'
import type { CanonicalMatchBundle, DesktopApi, StoredMatchSummary } from '../types'

const summary: StoredMatchSummary = { id: 'match-1', competition: '测试联赛', season: '2026', date: '2026-07-16', homeTeam: '主队', awayTeam: '客队', eventCount: 4, frameCount: 0, source: 'test' }
const bundle: CanonicalMatchBundle = {
  schemaVersion: 1,
  source: { provider: 'test', sourceId: 'match-1', importedAt: '2026-07-16T00:00:00.000Z' },
  match: { id: 'match-1', competition: '测试联赛', season: '2026', date: '2026-07-16', homeTeamId: 'home', awayTeamId: 'away', homeScore: 1, awayScore: 0 },
  teams: [{ id: 'home', name: '主队', color: '#36e39a' }, { id: 'away', name: '客队', color: 'not-a-css-color' }],
  players: [
    { id: 'home-1', name: '主队门将', teamId: 'home', shirtNumber: 1, position: '门将' },
    { id: 'home-9', name: '主队前锋', teamId: 'home', shirtNumber: 9, position: '中锋' },
    { id: 'away-1', name: '客队门将', teamId: 'away', shirtNumber: 1, position: '门将' },
    { id: 'away-9', name: '客队前锋', teamId: 'away', shirtNumber: 9, position: '中锋' }
  ],
  lineups: [],
  events: [
    { id: 'e1', matchId: 'match-1', period: 1, second: 1, teamId: 'home', playerId: 'home-1', recipientId: 'home-9', kind: 'pass', start: { x: 20, y: 34 }, end: { x: 72, y: 34 }, outcome: 'success' },
    { id: 'e2', matchId: 'match-1', period: 1, second: 2, teamId: 'home', playerId: 'home-9', kind: 'shot', start: { x: 92, y: 34 }, xg: .3 },
    { id: 'e3', matchId: 'match-1', period: 1, second: 3, teamId: 'away', playerId: 'away-1', recipientId: 'away-9', kind: 'pass', start: { x: 20, y: 34 }, end: { x: 50, y: 34 }, outcome: 'success' },
    { id: 'e4', matchId: 'match-1', period: 1, second: 4, teamId: 'away', playerId: 'away-9', kind: 'turnover', start: { x: 55, y: 34 } }
  ],
  frames: []
}

function installApi(overrides: Partial<DesktopApi> = {}) {
  const api = {
    getMatchBundle: vi.fn().mockResolvedValue(bundle),
    getTeamMatchBundles: vi.fn().mockResolvedValue([bundle]),
    ...overrides
  }
  Object.defineProperty(window, 'footballApi', { configurable: true, value: api })
  return api
}

afterEach(() => cleanup())

describe('球队分析中心页面', () => {
  it('加载多场分析、切换球队并可建立推演方案', async () => {
    const api = installApi()
    const onCreateScenario = vi.fn().mockResolvedValue(undefined)
    render(<TeamAnalysisPage matches={[summary]} onCreateScenario={onCreateScenario}/>)

    expect(await screen.findByLabelText('球队分析：主队')).toBeTruthy()
    expect(api.getTeamMatchBundles).toHaveBeenCalledWith('match-1', 'home')
    expect(screen.getByText('与实际对手基准比较')).toBeTruthy()
    expect(screen.getByText('球员战术贡献')).toBeTruthy()

    fireEvent.change(screen.getByRole('combobox', { name: '分析球队' }), { target: { value: 'away' } })
    expect(await screen.findByLabelText('球队分析：客队')).toBeTruthy()
    await waitFor(() => expect(api.getTeamMatchBundles).toHaveBeenLastCalledWith('match-1', 'away'))

    fireEvent.click(screen.getByRole('button', { name: '建立推演方案' }))
    expect(onCreateScenario).toHaveBeenCalledWith('match-1')
  })

  it('没有比赛时显示清晰的引导状态', () => {
    installApi()
    render(<TeamAnalysisPage matches={[]} onCreateScenario={vi.fn()}/>)
    expect(screen.getByText('球队分析需要比赛数据')).toBeTruthy()
  })

  it('读取失败后清空旧球队选项并允许重试', async () => {
    installApi({ getMatchBundle: vi.fn().mockRejectedValue(new Error('数据损坏')) })
    render(<TeamAnalysisPage matches={[summary]} onCreateScenario={vi.fn()}/>)
    expect(await screen.findByText('数据损坏')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: '分析球队' }) as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })
})
