import { describe, expect, it } from 'vitest'
import { createDemoScenario } from '../engine/demo'
import { createScenarioFromBundle, createScenarioFromBundles } from '../engine/history'
import type { CanonicalMatchBundle } from '../types'

function historicalBundle(): CanonicalMatchBundle {
  const demo = createDemoScenario()
  const players = [...demo.home, ...demo.away]
  const events = Array.from({ length: 40 }, (_, index) => ({
    id: `pass-${index}`, matchId: 'history-match', period: 1, second: index,
    teamId: 'home', playerId: 'home-10', recipientId: 'home-9', kind: 'pass' as const,
    start: { x: 48, y: 32 }, end: { x: 70, y: 34 }, outcome: index < 36 ? 'success' as const : 'failure' as const
  }))
  return {
    schemaVersion: 1, source: { provider: 'test-history', sourceId: 'history-match', importedAt: '2026-07-15T00:00:00.000Z' },
    match: { id: 'history-match', competition: '测试联赛', season: '2026', date: '2026-07-15', homeTeamId: 'home', awayTeamId: 'away' },
    teams: [{ id: 'home', name: '主队', color: '#0f0' }, { id: 'away', name: '客队', color: '#f00' }],
    players: players.map(player => ({ id: player.playerId, name: player.name, teamId: player.side, shirtNumber: player.shirtNumber, position: player.position })),
    lineups: players.map(player => ({ teamId: player.side, playerId: player.playerId, starter: true, position: player.position })),
    events,
    frames: Array.from({ length: 6 }, (_, index) => ({ second: index, players: [{ playerId: 'home-10', teammate: true, position: { x: 54 + index, y: 31 } }], confidence: 'observed' as const }))
  }
}

describe('历史比赛校准', () => {
  it('从导入比赛生成双方 11 人方案和球员历史先验', () => {
    const scenario = createScenarioFromBundle(historicalBundle())
    expect(scenario.home).toHaveLength(11)
    expect(scenario.away).toHaveLength(11)
    expect(scenario.sourceMatchId).toBe('history-match')
    expect(scenario.calibration).toMatchObject({ provider: 'test-history', eventCount: 40, frameCount: 6 })
    const observed = scenario.home.find(player => player.playerId === 'home-10')!
    expect(observed.historicalSampleSize).toBe(46)
    expect(observed.confidence).toBe('observed')
    expect(observed.passForward).toBeGreaterThan(70)
    expect(observed.attributes.passing).toBeGreaterThan(75)
    expect(observed.anchor.x).toBeGreaterThan(54)
    expect(scenario.away.every(player => player.anchor.x > 25)).toBe(true)
  })

  it('无完整阵容时使用明确的低置信度占位球员补足方案', () => {
    const bundle = historicalBundle()
    bundle.players = bundle.players.slice(0, 2)
    bundle.lineups = bundle.lineups.slice(0, 2)
    const scenario = createScenarioFromBundle(bundle)
    expect(scenario.home).toHaveLength(11)
    expect(scenario.away).toHaveLength(11)
    expect([...scenario.home, ...scenario.away].some(player => player.name.startsWith('待配置球员'))).toBe(true)
    expect(scenario.calibration!.lowSamplePlayers).toBeGreaterThan(0)
  })

  it('汇总同一数据源的多场球员样本并排除其他提供商', () => {
    const primary = historicalBundle()
    const related = structuredClone(primary)
    related.match.id = 'history-match-2'; related.source.sourceId = 'history-match-2'
    related.events = related.events.map((event, index) => ({ ...event, id: `second-${index}`, matchId: 'history-match-2' }))
    const unrelated = structuredClone(related)
    unrelated.source.provider = 'another-provider'
    const scenario = createScenarioFromBundles([primary, related, unrelated])
    const player = scenario.home.find(item => item.playerId === 'home-10')!
    expect(scenario.calibration).toMatchObject({ matchCount: 2, eventCount: 80, frameCount: 12 })
    expect(player.historicalSampleSize).toBe(92)
  })
})
