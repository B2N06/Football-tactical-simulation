import type { CanonicalMatchBundle, Player } from '../types'
import { parseCanonicalBundle } from './canonical'

export async function testFootballData(token: string): Promise<{ ok: boolean; message: string }> {
  if (!token.trim()) return { ok: false, message: '请输入 football-data.org API Token' }
  const response = await fetch('https://api.football-data.org/v4/competitions?limit=1', { headers: { 'X-Auth-Token': token.trim() } })
  if (response.status === 401 || response.status === 403) return { ok: false, message: 'Token 无效或没有访问权限' }
  if (!response.ok) return { ok: false, message: `连接失败：HTTP ${response.status}` }
  return { ok: true, message: '连接成功，football-data.org v4 可用。' }
}

export async function fetchFootballDataMatch(matchId: string, token: string): Promise<CanonicalMatchBundle> {
  if (!/^\d+$/.test(matchId)) throw new Error('football-data.org 比赛 ID 必须为数字')
  if (!token.trim()) throw new Error('请先保存 football-data.org API Token')
  const response = await fetch(`https://api.football-data.org/v4/matches/${matchId}`, { headers: { 'X-Auth-Token': token.trim() } })
  if (response.status === 401 || response.status === 403) throw new Error('Token 无效或订阅无权访问该比赛')
  if (!response.ok) throw new Error(`football-data.org 下载失败：HTTP ${response.status}`)
  return footballDataMatchToBundle(await response.json(), matchId)
}

export function footballDataMatchToBundle(value: unknown, matchId: string): CanonicalMatchBundle {
  if (!/^\d+$/.test(matchId)) throw new Error('football-data.org 比赛 ID 必须为数字')
  if (!value || typeof value !== 'object') throw new Error('football-data.org 比赛响应无效')
  const data = value as Record<string, any>
  const idOf = (entry: any, label: string): string => {
    if (!entry || !['string', 'number'].includes(typeof entry.id) || (typeof entry.id === 'number' && !Number.isFinite(entry.id)) || !String(entry.id).trim()) throw new Error(`football-data.org ${label}缺少有效 ID`)
    return String(entry.id).trim()
  }
  const homeId = idOf(data.homeTeam, '主队'), awayId = idOf(data.awayTeam, '客队')
  if (homeId === awayId) throw new Error('football-data.org 主队和客队 ID 不能相同')
  const starters = new Set<string>()
  const parsePlayers = (team: any, teamId: string): Player[] => {
    if (typeof team.name !== 'string' || !team.name.trim()) throw new Error('football-data.org 球队名称缺失')
    if ((team.lineup != null && !Array.isArray(team.lineup)) || (team.bench != null && !Array.isArray(team.bench))) throw new Error('football-data.org 阵容格式无效')
    for (const entry of team.lineup ?? []) starters.add(idOf(entry, '球员'))
    return [...(team.lineup ?? []), ...(team.bench ?? [])].map((entry: any) => {
      const id = idOf(entry, '球员')
      if (typeof entry.name !== 'string' || !entry.name.trim()) throw new Error('football-data.org 球员名称缺失')
      return { id, name: entry.name.trim(), teamId, shirtNumber: Number(entry.shirtNumber ?? 0), position: typeof entry.position === 'string' ? entry.position : '未知' }
    })
  }
  const records = [...parsePlayers(data.homeTeam, homeId), ...parsePlayers(data.awayTeam, awayId)]
  const byId = new Map<string, Player>()
  for (const player of records) {
    if (byId.has(player.id) && byId.get(player.id)!.teamId !== player.teamId) throw new Error('football-data.org 同一球员不能属于双方阵容')
    if (!byId.has(player.id)) byId.set(player.id, player)
  }
  const players = [...byId.values()]
  return parseCanonicalBundle({
    schemaVersion: 1,
    source: { provider: 'football-data.org v4', sourceId: matchId, importedAt: new Date().toISOString(), attribution: 'Match metadata supplied by football-data.org' },
    match: { id: `football-data-${matchId}`, competition: data.competition?.name ?? '未知赛事', season: typeof data.season?.startDate === 'string' ? data.season.startDate.slice(0, 4) : '未知', date: data.utcDate ?? '', homeTeamId: homeId, awayTeamId: awayId, homeScore: data.score?.fullTime?.home ?? undefined, awayScore: data.score?.fullTime?.away ?? undefined },
    teams: [{ id: homeId, name: data.homeTeam.name, color: '#19c37d' }, { id: awayId, name: data.awayTeam.name, color: '#ff7262' }],
    players,
    lineups: players.map(player => ({ teamId: player.teamId, playerId: player.id, starter: starters.has(player.id), position: player.position })),
    events: [], frames: []
  })
}
