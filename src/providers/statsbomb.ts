import type { CanonicalMatchBundle, MatchEvent, Player, Team, TrackingFrame } from '../types'
import { normalizeStatsBomb } from '../engine/coordinates'

type JsonObject = Record<string, any>

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map(item => [key(item), item])).values()]
}

export function statsBombEventsToBundle(events: JsonObject[], lineups: JsonObject[] = [], frames: JsonObject[] = [], sourceId = 'local'): CanonicalMatchBundle {
  if (!Array.isArray(events) || events.length === 0) throw new Error('StatsBomb 事件数组为空')
  const matchId = String(events[0].match_id ?? sourceId)
  const teams: Team[] = uniqueBy([
    ...events.filter(e => e.team).map(e => ({ id: String(e.team.id), name: e.team.name, color: '#23c483' })),
    ...lineups.filter(lineup => lineup.team_id != null).map(lineup => ({ id: String(lineup.team_id), name: lineup.team_name ?? `球队 ${lineup.team_id}`, color: '#78a8ff' }))
  ], item => item.id)
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
    const kind = kindMap[e.type.name]!
    const failed = Boolean(e.pass?.outcome || kind === 'turnover' || (kind === 'shot' && e.shot?.outcome?.name && e.shot.outcome.name !== 'Goal') || e.duel?.outcome?.name?.startsWith('Lost') || e.ball_recovery?.recovery_failure)
    return {
      id: String(e.id), matchId, period: Number(e.period ?? 1), second: Number(e.minute ?? 0) * 60 + Number(e.second ?? 0),
      teamId: String(e.team?.id ?? ''), playerId: e.player ? String(e.player.id) : undefined,
      recipientId: e.pass?.recipient ? String(e.pass.recipient.id) : undefined, kind,
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
  const maxFileBytes = 75 * 1024 * 1024
  const controllers = new Set<AbortController>()
  const fetchJson = async (path: string, optional = false): Promise<JsonObject[]> => {
    const controller = new AbortController()
    controllers.add(controller)
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 30000)
    try {
      const response = await fetch(`${base}/${path}`, { signal: controller.signal })
      if (!response.ok) {
        if (optional && response.status === 404) return []
        throw new Error(`StatsBomb 下载失败：${path} · HTTP ${response.status}`)
      }
      const declaredLength = response.headers.get('Content-Length')
      if (declaredLength !== null && Number(declaredLength) > maxFileBytes) throw new Error(`StatsBomb 文件过大：${path} 超过 75 MB 上限`)
      let text: string
      if (response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const parts: string[] = []
        let bytes = 0
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > maxFileBytes) throw new Error(`StatsBomb 文件过大：${path} 超过 75 MB 上限`)
            parts.push(decoder.decode(chunk.value, { stream: true }))
          }
          parts.push(decoder.decode())
          text = parts.join('')
        } finally { reader.releaseLock() }
      } else {
        text = await response.text()
        if (new TextEncoder().encode(text).byteLength > maxFileBytes) throw new Error(`StatsBomb 文件过大：${path} 超过 75 MB 上限`)
      }
      let parsed: unknown
      try { parsed = JSON.parse(text) }
      catch { throw new Error(`StatsBomb 数据格式无效：${path} 不是有效 JSON`) }
      if (!Array.isArray(parsed)) throw new Error(`StatsBomb 数据格式无效：${path} 必须是 JSON 数组`)
      return parsed as JsonObject[]
    } catch (error) {
      if (timedOut) throw new Error(`StatsBomb 下载超时：${path}（30 秒），请稍后重试`)
      if (error instanceof Error && error.message.startsWith('StatsBomb ')) throw error
      throw new Error(`StatsBomb 下载失败：${path} · ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timeout)
      controller.abort()
      controllers.delete(controller)
    }
  }
  try {
    const [events, lineups, frames] = await Promise.all([
      fetchJson(`events/${matchId}.json`), fetchJson(`lineups/${matchId}.json`, true), fetchJson(`three-sixty/${matchId}.json`, true)
    ])
    return statsBombEventsToBundle(events, lineups, frames, matchId)
  } finally {
    for (const controller of controllers) controller.abort()
  }
}
