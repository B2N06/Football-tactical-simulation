import { createDemoScenario } from '../engine/demo'
import type { CanonicalMatchBundle, MatchEvent } from '../types'

export function createBrowserDemoBundles(): CanonicalMatchBundle[] {
  const scenario = createDemoScenario()
  const players = [...scenario.home, ...scenario.away]
  return [
    { date: '2026-06-20', homeTeamId: 'home', awayTeamId: 'away', homeScore: 2, awayScore: 1 },
    { date: '2026-06-27', homeTeamId: 'away', awayTeamId: 'home', homeScore: 0, awayScore: 1 },
    { date: '2026-07-05', homeTeamId: 'home', awayTeamId: 'away', homeScore: 1, awayScore: 1 }
  ].map((definition, matchIndex) => {
    const matchId = `demo-team-${matchIndex + 1}`
    const events: MatchEvent[] = []
    for (const side of ['home', 'away'] as const) {
      const chain = [`${side}-1`, `${side}-4`, `${side}-6`, `${side}-10`, `${side}-11`, `${side}-9`]
      const points = [{ x: 8, y: 34 }, { x: 25, y: 38 }, { x: 44, y: 34 }, { x: 64, y: 27 }, { x: 84, y: 18 }, { x: 94, y: 34 }]
      chain.forEach((playerId, index) => {
        const eventIndex = events.length + 1
        const shot = index === chain.length - 1
        events.push({
          id: `${matchId}-event-${eventIndex}`, matchId, teamId: side, playerId,
          recipientId: shot ? undefined : chain[index + 1], period: side === 'home' ? 1 : 2, second: eventIndex * 45,
          kind: shot ? 'shot' : 'pass', start: points[index], end: shot ? { x: 105, y: 34 } : points[index + 1],
          outcome: !shot || matchIndex === 0 ? 'success' : 'failure', xg: shot ? .15 + matchIndex * .05 : undefined
        })
      })
      for (const [kind, playerId, start] of [
        ['pressure', `${side}-7`, { x: 74, y: 50 }],
        ['recovery', `${side}-8`, { x: 72, y: 38 }],
        ['turnover', `${side}-10`, { x: 56 + matchIndex * 3, y: 31 }]
      ] as const) {
        const eventIndex = events.length + 1
        events.push({ id: `${matchId}-event-${eventIndex}`, matchId, period: side === 'home' ? 1 : 2, second: eventIndex * 45, teamId: side, playerId, kind, start, outcome: kind === 'turnover' ? 'failure' : 'success' })
      }
    }
    return {
      schemaVersion: 1,
      source: { provider: '内置合成示例', sourceId: matchId, importedAt: new Date().toISOString(), attribution: '完全合成数据，仅用于产品演示与测试。' },
      match: { id: matchId, competition: '战术实验示例', season: '2026', ...definition },
      teams: [{ id: 'home', name: '海港竞技', color: '#19c37d' }, { id: 'away', name: '城南联队', color: '#ff7262' }],
      players: players.map(player => ({ id: player.playerId, name: player.name, teamId: player.side, shirtNumber: player.shirtNumber, position: player.position })),
      lineups: players.map(player => ({ teamId: player.side, playerId: player.playerId, starter: true, position: player.position })),
      events,
      frames: [{ second: 180, possessionTeamId: 'home', ball: { x: 64, y: 27 }, players: players.map(player => ({ playerId: player.playerId, teammate: player.side === 'home', position: { ...player.anchor } })), confidence: 'modelled-high' }]
    }
  })
}
