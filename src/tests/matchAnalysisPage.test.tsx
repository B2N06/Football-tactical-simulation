// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatchAnalysisPage } from '../components/MatchAnalysisPage'
import { createDemoScenario } from '../engine/demo'
import type { CanonicalMatchBundle, StoredMatchSummary } from '../types'

function demoBundle(id: string): CanonicalMatchBundle {
  const demo = createDemoScenario()
  const players = [...demo.home, ...demo.away].map(player => ({
    id: `${id}-${player.playerId}`, name: `${id} ${player.name}`, teamId: `${id}-${player.side}`,
    shirtNumber: player.shirtNumber, position: player.position
  }))
  const homeTeamId = `${id}-home`, awayTeamId = `${id}-away`
  return {
    schemaVersion: 1,
    source: { provider: 'test-match-data', sourceId: id, importedAt: '2026-10-08T00:00:00.000Z' },
    match: { id, competition: `${id} 测试赛事`, season: '2026', date: '2026-10-08', homeTeamId, awayTeamId },
    teams: [{ id: homeTeamId, name: `${id} 主队`, color: '#38a778' }, { id: awayTeamId, name: `${id} 客队`, color: '#c35642' }],
    players,
    lineups: players.map(player => ({ teamId: player.teamId, playerId: player.id, starter: true, position: player.position })),
    events: [
      { id: `${id}-e1`, matchId: id, period: 1, second: 1, teamId: homeTeamId, playerId: `${id}-home-1`, kind: 'pass', start: { x: 20, y: 34 }, end: { x: 50, y: 34 } },
      { id: `${id}-e2`, matchId: id, period: 1, second: 2, teamId: homeTeamId, playerId: `${id}-home-9`, kind: 'shot', start: { x: 90, y: 34 }, xg: .2 },
      { id: `${id}-e3`, matchId: id, period: 1, second: 3, teamId: awayTeamId, kind: 'shot', start: { x: 92, y: 36 } },
      { id: `${id}-e4`, matchId: id, period: 1, second: 4, teamId: homeTeamId, playerId: `${id}-home-9`, kind: 'shot', start: { x: 40, y: 5 }, xg: 0 }
    ],
    frames: []
  }
}

function summary(bundle: CanonicalMatchBundle): StoredMatchSummary {
  return {
    id: bundle.match.id, competition: bundle.match.competition, season: bundle.match.season, date: bundle.match.date,
    homeTeam: bundle.teams[0].name, awayTeam: bundle.teams[1].name,
    eventCount: bundle.events.length, frameCount: bundle.frames.length, source: bundle.source.provider
  }
}

function installApi(getMatchBundle: (id: string) => Promise<CanonicalMatchBundle>) {
  const api = { getMatchBundle: vi.fn(getMatchBundle) }
  Object.defineProperty(window, 'footballApi', { configurable: true, value: api })
  return api
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function metric(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('比赛分析页面真实数据回归', () => {
  it('切换比赛后读取对应档案和事件，而非沿用上一场或当前战术阵容', async () => {
    const first = demoBundle('first'), second = demoBundle('second')
    second.events = second.events.slice(0, 1)
    const api = installApi(id => Promise.resolve(id === first.match.id ? first : second))
    render(<MatchAnalysisPage matches={[summary(first), summary(second)]}/>)
    expect(await screen.findByRole('heading', { name: 'first 主队 vs first 客队' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择 first 海港 门将，门将' })).toBeTruthy()

    fireEvent.change(screen.getByRole('combobox', { name: '分析比赛' }), { target: { value: 'second' } })
    expect(await screen.findByRole('heading', { name: 'second 主队 vs second 客队' })).toBeTruthy()
    expect(api.getMatchBundle).toHaveBeenLastCalledWith('second')
    expect(screen.getByRole('button', { name: '选择 second 海港 门将，门将' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '选择 first 海港 门将，门将' })).toBeNull()
    expect(metric('比赛事件')).toBe('1')
    expect(metric('射门')).toBe('0')
  })

  it('事件归属和 xG 覆盖按实际字段计算，零 xG 是已知值而缺失值不计入', async () => {
    const bundle = demoBundle('coverage')
    installApi(() => Promise.resolve(bundle))
    render(<MatchAnalysisPage matches={[summary(bundle)]}/>)
    await screen.findByText('实际数据覆盖')
    expect(metric('比赛事件')).toBe('4')
    expect(metric('球员归属')).toBe('3 / 4 事件')
    expect(metric('xG 覆盖')).toBe('2 / 3 射门')
    expect(metric('已知 xG 总计')).toBe('0.20')
    expect(screen.getByText(/球员未标识 · 结果未标识/)).toBeTruthy()
    expect(screen.getAllByText(/结果未标识/).length).toBe(4)
  })

  it('所有射门均缺少 xG 时显示未提供，不能把未知表现显示为 0.00', async () => {
    const bundle = demoBundle('missing-xg')
    bundle.events.forEach(event => { delete event.xg })
    installApi(() => Promise.resolve(bundle))
    render(<MatchAnalysisPage matches={[summary(bundle)]}/>)
    await screen.findByText('实际数据覆盖')
    expect(metric('xG 覆盖')).toBe('0 / 3 射门')
    expect(metric('已知 xG 总计')).toBe('未提供')
  })

  it('modelled-high 空间帧始终标记为推断，不标为有观测坐标', async () => {
    const bundle = demoBundle('modelled')
    bundle.frames = [{ second: 1, possessionTeamId: bundle.match.homeTeamId, confidence: 'modelled-high', players: [
      { playerId: 'modelled-home-9', teammate: true, position: { x: 88, y: 34 } }
    ] }]
    installApi(() => Promise.resolve(bundle))
    render(<MatchAnalysisPage matches={[summary(bundle)]}/>)
    expect(await screen.findByText('站位由模型推断')).toBeTruthy()
    expect(screen.queryByText(/人有观测坐标/)).toBeNull()
    expect(metric('空间帧')).toBe('1')
  })

  it('观测帧内无法绑定阵容的 ID 不计为已观测球员', async () => {
    const bundle = demoBundle('unbound')
    bundle.frames = [{ second: 1, confidence: 'observed', players: [
      { playerId: 'unknown-player', teammate: true, position: { x: 80, y: 34 } }
    ] }]
    installApi(() => Promise.resolve(bundle))
    render(<MatchAnalysisPage matches={[summary(bundle)]}/>)
    await screen.findByText('实际数据覆盖')
    expect(screen.getByText('站位由模型推断')).toBeTruthy()
    expect(screen.queryByText(/人有观测坐标/)).toBeNull()
  })

  it('快速切换比赛后，旧异步响应不能覆盖新选择的档案和覆盖统计', async () => {
    const oldBundle = demoBundle('slow'), newBundle = demoBundle('latest')
    newBundle.events = newBundle.events.slice(0, 1)
    const oldRequest = deferred<CanonicalMatchBundle>()
    const api = installApi(id => id === 'slow' ? oldRequest.promise : Promise.resolve(newBundle))
    render(<MatchAnalysisPage matches={[summary(oldBundle), summary(newBundle)]}/>)
    await waitFor(() => expect(api.getMatchBundle).toHaveBeenCalledWith('slow'))
    fireEvent.change(screen.getByRole('combobox', { name: '分析比赛' }), { target: { value: 'latest' } })
    expect(await screen.findByRole('heading', { name: 'latest 主队 vs latest 客队' })).toBeTruthy()
    await act(async () => { oldRequest.resolve(oldBundle); await oldRequest.promise })
    expect(screen.queryByRole('heading', { name: 'slow 主队 vs slow 客队' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'latest 主队 vs latest 客队' })).toBeTruthy()
    expect((screen.getByRole('combobox', { name: '分析比赛' }) as HTMLSelectElement).value).toBe('latest')
    expect(metric('比赛事件')).toBe('1')
  })

  it('读取中移除全部比赛时清空加载状态，迟到数据不会重新显示', async () => {
    const bundle = demoBundle('removed'), request = deferred<CanonicalMatchBundle>()
    installApi(() => request.promise)
    const view = render(<MatchAnalysisPage matches={[summary(bundle)]}/>)
    expect(screen.getByRole('status')).toBeTruthy()
    view.rerender(<MatchAnalysisPage matches={[]}/>)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(screen.getByText('还没有可分析的比赛')).toBeTruthy()
    await act(async () => { request.resolve(bundle); await request.promise })
    expect(screen.queryByText('实际数据覆盖')).toBeNull()
  })
})
