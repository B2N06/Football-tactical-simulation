import type { CanonicalMatchBundle, MatchEvent, Player, Team, TrackingFrame } from '../types'
import { normalizeStatsBomb } from '../engine/coordinates'

type JsonObject = Record<string, any>

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map(item => [key(item), item])).values()]
}

export function statsBombEventsToBundle(events: JsonObject[], lineups: JsonObject[] = [], frames: JsonObject[] = [], sourceId = 'local'): CanonicalMatchBundle {
  if (!Array.isArray(events) || events.length === 0) throw new Error('StatsBomb 事件数组为空')
  const matchId = String(events[0].match_id ?? sourceId)
  const teams: Team[] = uniqueBy(events.filter(e => e.team).map(e => ({ id: String(e.team.id), name: e.team.name, color: '#23c483' })), item => item.id)
  if (teams.length < 2) {
    for (const lineup of lineups) if (lineup.team_id) teams.push({ id: String(lineup.team_id), name: lineup.team_name ?? `球队 ${lineup.team_id}`, color: '#78a8ff' })
  }
  const playersFromEvents: Player[] = events.filter(e => e.player).map(e => ({
    id: String(e.player.id), name: e.player.name, teamId: String(e.team?.id ?? ''), shirtNumber: 0, position: e.position?.name ?? '未知'
  }))
  const playersFromLineups: Player[] = lineups.flatMap(team => (team.lineup ?? []).map((entry: JsonObject) => ({
    id: String(entry.player_id), name: entry.player_name, teamId: String(team.team_id), shirtNumber: Number(entry.jersey_number ?? 0),
    position: entry.positions?.[0]?.position?.name ?? entry.positions?.[0]?.position ?? '未知'
  })))
  const players = uniqueBy([...playersFromEvents, ...playersFromLineups], item => item.id)
  const canonicalLineups = lineups.flatMap(team => (team.lineup ?? []).map((entry: JsonObject) => ({
    teamId: String(team.team_id), playerId: String(entry.player_id),
    starter: Boolean(entry.positions?.some((position: JsonObject) => position.from === '00:00')),
    position: entry.positions?.[0]?.position?.name ?? entry.positions?.[0]?.position ?? '未知'
  })))
  const kindMap: Record<string, MatchEvent['kind'] | undefined> = {
    Pass: 'pass', Carry: 'carry', Shot: 'shot', Duel: 'duel', Pressure: 'pressure', Dispossessed: 'turnover', Interception: 'recovery', 'Ball Recovery': 'recovery'
  }
  const canonicalEvents: MatchEvent[] = events.filter(e => e.location && kindMap[e.type?.name]).map(e => {
    const endLocation = e.pass?.end_location ?? e.carry?.end_location ?? e.shot?.end_location
    const failed = Boolean(e.pass?.outcome || e.dribble?.outcome?.name === 'Incomplete')
    return {
      id: String(e.id), matchId, period: Number(e.period ?? 1), second: Number(e.minute ?? 0) * 60 + Number(e.second ?? 0),
      teamId: String(e.team?.id ?? ''), playerId: e.player ? String(e.player.id) : undefined,
      recipientId: e.pass?.recipient ? String(e.pass.recipient.id) : undefined, kind: kindMap[e.type.name]!,
      start: normalizeStatsBomb(e.location), end: endLocation ? normalizeStatsBomb(endLocation) : undefined,
      outcome: failed ? 'failure' : 'success', xg: e.shot?.statsbomb_xg, underPressure: Boolean(e.under_pressure), raw: e
    }
  })
  const frameByEvent = new Map(frames.map(frame => [String(frame.event_uuid), frame]))
  const trackingFrames: TrackingFrame[] = events.filter(e => frameByEvent.has(String(e.id))).map(e => {
    const frame = frameByEvent.get(String(e.id))!
    return {
      second: Number(e.minute ?? 0) * 60 + Number(e.second ?? 0), possessionTeamId: String(e.possession_team?.id ?? e.team?.id ?? ''),
      ball: e.location ? normalizeStatsBomb(e.location) : undefined,
      players: (frame.freeze_frame ?? []).map((point: JsonObject) => ({ teammate: Boolean(point.teammate), position: normalizeStatsBomb(point.location) })),
      confidence: 'observed'
    }
  })
  return {
    schemaVersion: 1,
    source: { provider: 'StatsBomb Open Data', sourceId, importedAt: new Date().toISOString(), attribution: 'Data supplied by StatsBomb Open Data' },
    match: { id: matchId, competition: 'StatsBomb Open Data', season: '未知赛季', date: '', homeTeamId: teams[0]?.id ?? 'home', awayTeamId: teams[1]?.id ?? 'away' },
    teams: uniqueBy(teams, item => item.id), players,
    lineups: canonicalLineups.length ? canonicalLineups : players.map(player => ({ teamId: player.teamId, playerId: player.id, starter: true, position: player.position })),
    events: canonicalEvents, frames: trackingFrames
  }
}

export async function fetchStatsBombOpenMatch(matchId: string): Promise<CanonicalMatchBundle> {
  if (!/^\d+$/.test(matchId)) throw new Error('比赛 ID 必须为数字')
  const base = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data'
  const fetchJson = async (path: string, optional = false): Promise<any[]> => {
    const response = await fetch(`${base}/${path}`)
    if (!response.ok) {
      if (optional && response.status === 404) return []
      throw new Error(`StatsBomb 下载失败：HTTP ${response.status}`)
    }
    return await response.json() as any[]
  }
  const [events, lineups, frames] = await Promise.all([
    fetchJson(`events/${matchId}.json`), fetchJson(`lineups/${matchId}.json`, true), fetchJson(`three-sixty/${matchId}.json`, true)
  ])
  return statsBombEventsToBundle(events, lineups, frames, matchId)
}
