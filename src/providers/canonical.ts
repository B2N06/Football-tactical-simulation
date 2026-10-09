import Papa from 'papaparse'
import { z } from 'zod'
import type { CanonicalMatchBundle, TrackingFrame } from '../types'
import { normalizeCoordinate } from '../engine/coordinates'

const vecSchema = z.object({ x: z.number().finite().min(0).max(105), y: z.number().finite().min(0).max(68) })
const canonicalSchema = z.object({
  schemaVersion: z.literal(1), source: z.object({ provider: z.string(), sourceId: z.string(), importedAt: z.string(), attribution: z.string().optional() }),
  match: z.object({ id: z.string().min(1), competition: z.string(), season: z.string(), date: z.string(), homeTeamId: z.string().min(1), awayTeamId: z.string().min(1), homeScore: z.number().int().min(0).optional(), awayScore: z.number().int().min(0).optional() }),
  teams: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })).min(2),
  players: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string(), shirtNumber: z.number(), position: z.string() })),
  lineups: z.array(z.object({ teamId: z.string(), playerId: z.string(), starter: z.boolean(), position: z.string().optional() })),
  events: z.array(z.object({ id: z.string().min(1), matchId: z.string().min(1), period: z.number().int().min(1), second: z.number().finite().min(0), teamId: z.string().min(1), playerId: z.string().optional(), recipientId: z.string().optional(), kind: z.enum(['pass','carry','shot','duel','pressure','turnover','recovery']), start: vecSchema, end: vecSchema.optional(), outcome: z.enum(['success','failure']).optional(), xg: z.number().finite().min(0).max(1).optional(), underPressure: z.boolean().optional(), raw: z.unknown().optional() })),
  frames: z.array(z.object({ second: z.number().finite().min(0), possessionTeamId: z.string().optional(), ball: vecSchema.optional(), players: z.array(z.object({ playerId: z.string().optional(), teammate: z.boolean(), position: vecSchema, speed: z.number().finite().min(0).optional() })), confidence: z.enum(['observed','modelled-high','modelled-low']) })),
  heatmapReferences: z.array(z.object({ playerId: z.string().optional(), name: z.string(), dataUrl: z.string().optional() })).optional()
})

export function parseCanonicalBundle(value: unknown): CanonicalMatchBundle {
  const result = canonicalSchema.safeParse(value)
  if (!result.success) throw new Error(`标准数据格式无效：${result.error.issues.slice(0, 3).map(issue => issue.path.join('.')).join('、')}`)
  return result.data as CanonicalMatchBundle
}

export function parseTrackingCsv(text: string, fileName: string): CanonicalMatchBundle {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
  if (parsed.errors.length) throw new Error(`CSV 解析失败：${parsed.errors[0].message}`)
  const required = ['second', 'player_id', 'teammate', 'x', 'y']
  const fields = parsed.meta.fields ?? []
  const missing = required.filter(field => !fields.includes(field))
  if (missing.length) throw new Error(`CSV 缺少字段：${missing.join(', ')}`)
  const isTeammate = (value: string): boolean => {
    const normalized = value?.trim().toLowerCase()
    if (['1', 'true', 'yes', 'y'].includes(normalized)) return true
    if (['0', 'false', 'no', 'n'].includes(normalized)) return false
    throw new Error('CSV teammate 必须为 true/false、1/0 或 yes/no')
  }
  const numberField = (value: string | undefined, label: string): number => {
    if (!value?.trim()) throw new Error(`CSV ${label} 字段不能为空`)
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) throw new Error(`CSV ${label} 字段必须为有限数字`)
    return parsedValue
  }
  const grouped = new Map<number, TrackingFrame>()
  const playerSides = new Map<string, boolean>()
  if (!parsed.data.length) throw new Error('CSV 没有追踪数据行')
  for (const row of parsed.data) {
    if (!row.player_id?.trim()) throw new Error('CSV player_id 不能为空')
    const playerId = row.player_id.trim(), teammate = isTeammate(row.teammate)
    if (playerSides.has(playerId) && playerSides.get(playerId) !== teammate) throw new Error(`CSV 球员 ${playerId} 的所属方前后不一致`)
    playerSides.set(playerId, teammate)
    const second = numberField(row.second, 'second'), width = numberField(row.pitch_width || '105', 'pitch_width'), height = numberField(row.pitch_height || '68', 'pitch_height')
    const x = numberField(row.x, 'x'), y = numberField(row.y, 'y')
    if (second < 0) throw new Error('CSV second 不能为负数')
    if (width <= 0 || height <= 0) throw new Error('CSV 球场宽高必须大于 0')
    if (x < 0 || x > width || y < 0 || y > height) throw new Error(`CSV 坐标 (${x}, ${y}) 超出 ${width} × ${height} 的源球场范围`)
    const frame = grouped.get(second) ?? { second, possessionTeamId: row.possession_team_id?.trim() || undefined, players: [], confidence: 'observed' as const }
    if (frame.players.some(player => player.playerId === playerId)) throw new Error(`CSV ${second} 秒内球员 ${playerId} 出现重复坐标`)
    const possessionTeamId = row.possession_team_id?.trim() || undefined
    if (possessionTeamId && frame.possessionTeamId && possessionTeamId !== frame.possessionTeamId) throw new Error(`CSV ${second} 秒内球权方不一致`)
    frame.possessionTeamId = possessionTeamId ?? frame.possessionTeamId
    const speed = row.speed?.trim() ? numberField(row.speed, 'speed') : undefined
    if (speed !== undefined && speed < 0) throw new Error('CSV speed 不能为负数')
    frame.players.push({ playerId, teammate, position: normalizeCoordinate({ x, y }, width, height), speed })
    const hasBallX = Boolean(row.ball_x?.trim()), hasBallY = Boolean(row.ball_y?.trim())
    if (hasBallX !== hasBallY) throw new Error('CSV ball_x 与 ball_y 必须同时提供')
    if (hasBallX) {
      const ballX = numberField(row.ball_x, 'ball_x'), ballY = numberField(row.ball_y, 'ball_y')
      if (ballX < 0 || ballX > width || ballY < 0 || ballY > height) throw new Error('CSV 皮球坐标超出源球场范围')
      const ball = normalizeCoordinate({ x: ballX, y: ballY }, width, height)
      if (frame.ball && (Math.abs(frame.ball.x - ball.x) > .001 || Math.abs(frame.ball.y - ball.y) > .001)) throw new Error(`CSV ${second} 秒内皮球坐标不一致`)
      frame.ball = ball
    }
    grouped.set(second, frame)
  }
  const matchId = `tracking-${fileName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`
  const playerIds = [...playerSides.keys()]
  return {
    schemaVersion: 1, source: { provider: 'Local tracking CSV', sourceId: fileName, importedAt: new Date().toISOString() },
    match: { id: matchId, competition: '本地追踪数据', season: '未知', date: '', homeTeamId: 'home', awayTeamId: 'away' },
    teams: [{ id: 'home', name: '主队', color: '#19c37d' }, { id: 'away', name: '客队', color: '#ff7262' }],
    players: playerIds.map((id, index) => ({ id, name: id, teamId: playerSides.get(id) ? 'home' : 'away', shirtNumber: index + 1, position: '未知' })),
    lineups: [], events: [], frames: [...grouped.values()].sort((a, b) => a.second - b.second)
  }
}
