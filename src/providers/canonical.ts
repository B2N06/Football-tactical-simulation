import Papa from 'papaparse'
import { z } from 'zod'
import type { CanonicalMatchBundle, TrackingFrame } from '../types'
import { normalizeCoordinate } from '../engine/coordinates'

const vecSchema = z.object({ x: z.number().finite(), y: z.number().finite() })
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
  const grouped = new Map<number, TrackingFrame>()
  for (const row of parsed.data) {
    const second = Number(row.second), width = Number(row.pitch_width || 105), height = Number(row.pitch_height || 68)
    if (!Number.isFinite(second)) throw new Error('CSV second 字段必须为数字')
    const frame = grouped.get(second) ?? { second, possessionTeamId: row.possession_team_id, players: [], confidence: 'observed' as const }
    frame.players.push({ playerId: row.player_id, teammate: ['1','true','yes'].includes(row.teammate.toLowerCase()), position: normalizeCoordinate({ x: Number(row.x), y: Number(row.y) }, width, height), speed: row.speed ? Number(row.speed) : undefined })
    if (row.ball_x && row.ball_y) frame.ball = normalizeCoordinate({ x: Number(row.ball_x), y: Number(row.ball_y) }, width, height)
    grouped.set(second, frame)
  }
  const matchId = `tracking-${fileName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`
  const playerIds = [...new Set(parsed.data.map(row => row.player_id))]
  return {
    schemaVersion: 1, source: { provider: 'Local tracking CSV', sourceId: fileName, importedAt: new Date().toISOString() },
    match: { id: matchId, competition: '本地追踪数据', season: '未知', date: '', homeTeamId: 'home', awayTeamId: 'away' },
    teams: [{ id: 'home', name: '主队', color: '#19c37d' }, { id: 'away', name: '客队', color: '#ff7262' }],
    players: playerIds.map((id, index) => ({ id, name: id, teamId: parsed.data.find(row => row.player_id === id)?.teammate === 'true' ? 'home' : 'away', shirtNumber: index + 1, position: '未知' })),
    lineups: [], events: [], frames: [...grouped.values()].sort((a, b) => a.second - b.second)
  }
}
