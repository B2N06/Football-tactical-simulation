import type { CanonicalMatchBundle, Player } from '../types'

export async function testFootballData(token: string): Promise<{ ok: boolean; message: string }> {
  if (!token.trim()) return { ok: false, message: '请输入 football-data.org API Token' }
  const response = await fetch('https://api.football-data.org/v4/competitions?limit=1', { headers: { 'X-Auth-Token': token.trim() } })
  if (response.status === 401 || response.status === 403) return { ok: false, message: 'Token 无效或没有访问权限' }
  if (!response.ok) return { ok: false, message: `连接失败：HTTP ${response.status}` }
  return { ok: true, message: '连接成功，football-data.org v4 可用。' }
}

export async function fetchFootballDataMatch(matchId: string, token: string): Promise<CanonicalMatchBundle> {
  if (!/^\d+$/.test(matchId)) throw new Error('football-data.org 比赛 ID 必须为数字')
  if (!token) throw new Error('请先保存 football-data.org API Token')
  const response = await fetch(`https://api.football-data.org/v4/matches/${matchId}`, { headers: { 'X-Auth-Token': token } })
  if (response.status === 401 || response.status === 403) throw new Error('Token 无效或订阅无权访问该比赛')
  if (!response.ok) throw new Error(`football-data.org 下载失败：HTTP ${response.status}`)
  const data = await response.json() as any
  const homeId = String(data.homeTeam.id), awayId = String(data.awayTeam.id)
  const parsePlayers = (team: any, teamId: string): Player[] => [...(team.lineup ?? []), ...(team.bench ?? [])].map((entry: any) => ({
    id: String(entry.id), name: entry.name, teamId, shirtNumber: Number(entry.shirtNumber ?? 0), position: entry.position ?? '未知'
  }))
  const players = [...parsePlayers(data.homeTeam, homeId), ...parsePlayers(data.awayTeam, awayId)]
  return {
    schemaVersion: 1,
    source: { provider: 'football-data.org v4', sourceId: matchId, importedAt: new Date().toISOString(), attribution: 'Match metadata supplied by football-data.org' },
    match: { id: `football-data-${matchId}`, competition: data.competition?.name ?? '未知赛事', season: String(data.season?.startDate?.slice(0, 4) ?? '未知'), date: data.utcDate ?? '', homeTeamId: homeId, awayTeamId: awayId, homeScore: data.score?.fullTime?.home ?? undefined, awayScore: data.score?.fullTime?.away ?? undefined },
    teams: [{ id: homeId, name: data.homeTeam.name, color: '#19c37d' }, { id: awayId, name: data.awayTeam.name, color: '#ff7262' }],
    players,
    lineups: players.map(player => ({ teamId: player.teamId, playerId: player.id, starter: [...(data[player.teamId === homeId ? 'homeTeam' : 'awayTeam'].lineup ?? [])].some((entry: any) => String(entry.id) === player.id), position: player.position })),
    events: [], frames: []
  }
}
