import Papa from 'papaparse'
import { z } from 'zod'
import type { CanonicalMatchBundle, TrackingFrame } from '../types'
import { normalizeCoordinate } from '../engine/coordinates'

const vecSchema = z.object({ x: z.number().finite().min(0).max(105), y: z.number().finite().min(0).max(68) })
const canonicalSchema = z.object({
  schemaVersion: z.literal(1), source: z.object({ provider: z.string(), sourceId: z.string(), importedAt: z.string(), attribution: z.string().optional() }),
  match: z.object({ id: z.string(), competition: z.string(), season: z.string(), date: z.string(), homeTeamId: z.string(), awayTeamId: z.string(), homeScore: z.number().optional(), awayScore: z.number().optional() }),
  teams: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })).min(2),
  players: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string(), shirtNumber: z.number(), position: z.string() })),
  lineups: z.array(z.object({ teamId: z.string(), playerId: z.string(), starter: z.boolean(), position: z.string().optional() })),
  events: z.array(z.object({ id: z.string(), matchId: z.string(), period: z.number(), second: z.number(), teamId: z.string(), playerId: z.string().optional(), recipientId: z.string().optional(), kind: z.enum(['pass','carry','shot','duel','pressure','turnover','recovery']), start: vecSchema, end: vecSchema.optional(), outcome: z.enum(['success','failure']).optional(), xg: z.number().optional(), underPressure: z.boolean().optional(), raw: z.unknown().optional() })),
  frames: z.array(z.object({ second: z.number(), possessionTeamId: z.string().optional(), ball: vecSchema.optional(), players: z.array(z.object({ playerId: z.string().optional(), teammate: z.boolean(), position: vecSchema, speed: z.number().optional() })), confidence: z.enum(['observed','modelled-high','modelled-low']) })),
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
  const isTeammate = (value: string) => ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase())
  const numberField = (value: string | undefined, label: string): number => {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) throw new Error(`CSV ${label} 字段必须为有限数字`)
    return parsedValue
  }
  const grouped = new Map<number, TrackingFrame>()
  for (const row of parsed.data) {
    if (!row.player_id?.trim()) throw new Error('CSV player_id 不能为空')
    const second = numberField(row.second, 'second'), width = numberField(row.pitch_width || '105', 'pitch_width'), height = numberField(row.pitch_height || '68', 'pitch_height')
    const x = numberField(row.x, 'x'), y = numberField(row.y, 'y')
    if (second < 0) throw new Error('CSV second 不能为负数')
    if (width <= 0 || height <= 0) throw new Error('CSV 球场宽高必须大于 0')
    if (x < 0 || x > width || y < 0 || y > height) throw new Error(`CSV 坐标 (${x}, ${y}) 超出 ${width} × ${height} 的源球场范围`)
    const frame = grouped.get(second) ?? { second, possessionTeamId: row.possession_team_id, players: [], confidence: 'observed' as const }
    const speed = row.speed?.trim() ? numberField(row.speed, 'speed') : undefined
    if (speed !== undefined && speed < 0) throw new Error('CSV speed 不能为负数')
    frame.players.push({ playerId: row.player_id.trim(), teammate: isTeammate(row.teammate), position: normalizeCoordinate({ x, y }, width, height), speed })
    const hasBallX = Boolean(row.ball_x?.trim()), hasBallY = Boolean(row.ball_y?.trim())
    if (hasBallX !== hasBallY) throw new Error('CSV ball_x 与 ball_y 必须同时提供')
    if (hasBallX) {
      const ballX = numberField(row.ball_x, 'ball_x'), ballY = numberField(row.ball_y, 'ball_y')
      if (ballX < 0 || ballX > width || ballY < 0 || ballY > height) throw new Error('CSV 皮球坐标超出源球场范围')
      frame.ball = normalizeCoordinate({ x: ballX, y: ballY }, width, height)
    }
    grouped.set(second, frame)
  }
  const matchId = `tracking-${fileName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`
  const playerIds = [...new Set(parsed.data.map(row => row.player_id))]
  return {
    schemaVersion: 1, source: { provider: 'Local tracking CSV', sourceId: fileName, importedAt: new Date().toISOString() },
    match: { id: matchId, competition: '本地追踪数据', season: '未知', date: '', homeTeamId: 'home', awayTeamId: 'away' },
    teams: [{ id: 'home', name: '主队', color: '#19c37d' }, { id: 'away', name: '客队', color: '#ff7262' }],
    players: playerIds.map((id, index) => ({ id, name: id, teamId: isTeammate(parsed.data.find(row => row.player_id?.trim() === id)?.teammate ?? '') ? 'home' : 'away', shirtNumber: index + 1, position: '未知' })),
    lineups: [], events: [], frames: [...grouped.values()].sort((a, b) => a.second - b.second)
  }
}
