import { describe, expect, it } from 'vitest'
import { buildTeamTacticalAnalysis } from '../engine/teamAnalysis'
import type { CanonicalMatchBundle, MatchEvent, Player } from '../types'

const positions = ['门将', '左后卫', '中后卫', '中后卫', '右后卫', '中前卫', '中前卫', '中前卫', '左边锋', '中锋', '右边锋']
const teamPlayers: Player[] = positions.map((position, index) => ({ id: `a-${index + 1}`, name: `A球员${index + 1}`, teamId: 'a', shirtNumber: index + 1, position }))
const opponentPlayers: Player[] = [
  { id: 'b-1', name: 'B球员1', teamId: 'b', shirtNumber: 1, position: '门将' },
  { id: 'b-9', name: 'B球员9', teamId: 'b', shirtNumber: 9, position: '中锋' }
]

function event(matchId: string, id: string, teamId: string, playerId: string, kind: MatchEvent['kind'], x: number, endX?: number, outcome?: MatchEvent['outcome'], recipientId?: string, xg?: number): MatchEvent {
  return { id: `${matchId}-${id}`, matchId, period: 1, second: Number(id.replace(/\D/g, '')) || 1, teamId, playerId, recipientId, kind, start: { x, y: 34 }, end: endX === undefined ? undefined : { x: endX, y: 34 }, outcome, xg }
}

function bundle(id: string, date: string, home: boolean, score: [number, number], provider = 'club-feed'): CanonicalMatchBundle {
  const events = [
    event(id, 'e1', 'a', 'a-2', 'pass', 20, 45, 'success', 'a-6'),
    event(id, 'e2', 'a', 'a-6', 'pass', 62, 74, 'success', 'a-10'),
    event(id, 'e3', 'a', 'a-10', 'carry', 82, 90, 'success'),
    event(id, 'e4', 'a', 'a-10', 'shot', 92, 105, 'success', undefined, .25),
    event(id, 'e5', 'a', 'a-1', 'pass', 10, 80, 'failure', 'a-10'),
    event(id, 'e6', 'a', 'a-7', 'pressure', 72),
    event(id, 'e7', 'a', 'a-7', 'recovery', 74),
    event(id, 'e8', 'b', 'b-1', 'pass', 10, 35, 'success', 'b-9'),
    event(id, 'e9', 'b', 'b-9', 'pass', 30, 50, 'success', 'b-1'),
    event(id, 'e10', 'b', 'b-9', 'shot', 90, 105, 'success', undefined, .1),
    event(id, 'e11', 'b', 'b-9', 'turnover', 55)
  ]
  return {
    schemaVersion: 1,
    source: { provider, sourceId: id, importedAt: '2026-07-16T00:00:00.000Z' },
    match: {
      id, competition: '测试联赛', season: '2026', date,
      homeTeamId: home ? 'a' : 'b', awayTeamId: home ? 'b' : 'a',
      homeScore: score[0], awayScore: score[1]
    },
    teams: [{ id: 'a', name: '分析队', color: '#36e39a' }, { id: 'b', name: '对手队', color: '#ff7067' }],
    players: [...teamPlayers, ...opponentPlayers],
    lineups: teamPlayers.map(player => ({ teamId: 'a', playerId: player.id, starter: true })),
    events,
    frames: id === 'm1' ? [{ second: 1, possessionTeamId: 'a', players: [], confidence: 'observed' }] : []
  }
}

describe('球队多场战术分析', () => {
  it('统一汇总主客场数据、对手基准、阵型、区域和球员贡献', () => {
    const input = [
      bundle('m3', '2026-03-03', true, [1, 1]),
      bundle('m1', '2026-01-01', true, [2, 0]),
      bundle('m2', '2026-02-02', false, [1, 2]),
      bundle('ignored-provider', '2026-04-01', true, [9, 0], 'other-feed')
    ]
    const analysis = buildTeamTacticalAnalysis(input, 'a')

    expect(analysis.matchesAnalyzed).toBe(3)
    expect(analysis.dateRange).toEqual({ from: '2026-01-01', to: '2026-03-03' })
    expect(analysis.record).toMatchObject({ wins: 2, draws: 1, losses: 0, goalsFor: 5, goalsAgainst: 2, scoredMatches: 3 })
    expect(analysis.trends.map(item => item.matchId)).toEqual(['m1', 'm2', 'm3'])
    expect(analysis.trends[1]).toMatchObject({ venue: '客场', score: '2-1', result: '胜' })

    expect(analysis.metrics.passSuccess).toBeCloseTo(2 / 3, 4)
    expect(analysis.metrics.progressiveActionsPerMatch).toBe(2)
    expect(analysis.metrics.finalThirdEntriesPerMatch).toBe(1)
    expect(analysis.metrics.boxEntriesPerMatch).toBe(1)
    expect(analysis.metrics.xgPerMatch).toBe(.25)
    expect(analysis.metrics.ppdaApprox).toBe(2)
    expect(analysis.metrics.highRegainsPerMatch).toBe(1)
    expect(analysis.opponentMetrics.progressiveActionsPerMatch).toBe(2)

    expect(analysis.formationUsage[0]).toMatchObject({ formation: '4-3-3', count: 3, share: 1 })
    expect(analysis.zones).toHaveLength(12)
    expect(analysis.zones.reduce((sum, zone) => sum + zone.actionShare, 0)).toBeCloseTo(1, 3)
    expect(analysis.players.find(player => player.playerId === 'a-10')).toMatchObject({ matches: 3, shots: 3, carries: 3, xg: .75 })
    expect(analysis.passNetwork[0]).toMatchObject({ count: 3 })
    expect(analysis.dataQuality).toMatchObject({ scoreCoverage: 1, xgCoverage: 1, playerAttribution: 1 })
    expect(analysis.dataQuality.trackingCoverage).toBeCloseTo(1 / 3, 4)
    expect(analysis.insights.every(insight => insight.evidence && insight.action)).toBe(true)
  })

  it('客场比赛仍按标准数据的从左向右进攻方向计算，不进行二次翻转', () => {
    const analysis = buildTeamTacticalAnalysis([bundle('away', '2026-01-02', false, [0, 1])], 'a')
    expect(analysis.metrics.progressiveActionsPerMatch).toBe(2)
    expect(analysis.metrics.finalThirdEntriesPerMatch).toBe(1)
    expect(analysis.metrics.boxEntriesPerMatch).toBe(1)
  })

  it('低数据覆盖给出明确说明且不会产生 NaN', () => {
    const sparse = bundle('sparse', '', true, [0, 0])
    delete sparse.match.homeScore; delete sparse.match.awayScore
    sparse.events = []; sparse.lineups = []
    const analysis = buildTeamTacticalAnalysis([sparse], 'a')
    expect(analysis.metrics.xgPerMatch).toBeNull()
    expect(analysis.dataQuality.xgCoverage).toBe(0)
    expect(analysis.dataQuality.notes).toContain('当前样本没有射门事件，无法评估机会质量与 xG。')
    expect(JSON.stringify(analysis)).not.toContain('NaN')
  })

  it('拒绝分析未参加基准数据的球队', () => {
    const source = bundle('m1', '2026-01-01', true, [1, 0])
    source.teams.push({ id: 'metadata-only', name: '元数据球队', color: '#999' })
    expect(() => buildTeamTacticalAnalysis([source], 'metadata-only')).toThrow('不存在球队')
  })
})
