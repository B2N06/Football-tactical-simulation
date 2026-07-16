import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ImportService } from '../../electron/importer'
import { statsBombEventsToBundle } from '../providers/statsbomb'
import { parseCanonicalBundle, parseTrackingCsv } from '../providers/canonical'
import { DisabledAiProvider } from '../providers/ai'

describe('数据适配器', () => {
  it('转换 StatsBomb 事件并保留原始数据', () => {
    const bundle = statsBombEventsToBundle([
      { id: 'a', match_id: 42, period: 1, minute: 1, second: 4, type: { name: 'Pass' }, team: { id: 1, name: 'A' }, player: { id: 11, name: '甲' }, location: [60, 40], pass: { end_location: [90, 40], recipient: { id: 12, name: '乙' } } },
      { id: 'b', match_id: 42, period: 1, minute: 1, second: 7, type: { name: 'Pressure' }, team: { id: 2, name: 'B' }, player: { id: 21, name: '丙' }, location: [90, 42] }
    ])
    expect(bundle.events).toHaveLength(2)
    expect(bundle.events[0].start).toEqual({ x: 52.5, y: 34 })
    expect(bundle.events[0].recipientId).toBe('12')
    expect(bundle.teams).toHaveLength(2)
  })
  it('AI 占位实现明确拒绝调用', async () => {
    const provider = new DisabledAiProvider()
    expect(provider.enabled).toBe(false)
    await expect(provider.analyse({} as never, {} as never)).rejects.toThrow('未启用')
  })
  it('读取追踪 CSV 时统一布尔值、零坐标并拒绝越界数据', () => {
    const text = 'second,player_id,teammate,x,y,ball_x,ball_y,pitch_width,pitch_height\n0,p1,yes,0,0,0,0,100,50\n0,p2,no,100,50,0,0,100,50'
    const bundle = parseTrackingCsv(text, 'tracking.csv')
    expect(bundle.players.find(player => player.id === 'p1')?.teamId).toBe('home')
    expect(bundle.frames[0].ball).toEqual({ x: 0, y: 0 })
    expect(bundle.frames[0].players[1].position).toEqual({ x: 105, y: 68 })
    expect(() => parseTrackingCsv('second,player_id,teammate,x,y\n0,p1,true,106,2', 'bad.csv')).toThrow('超出')
  })
  it('读取 StatsBomb 阵容中的位置名称而不是原始对象', () => {
    const bundle = statsBombEventsToBundle([
      { id: 'a', match_id: 7, type: { name: 'Pass' }, team: { id: 1, name: 'A' }, player: { id: 11, name: '甲' }, location: [10, 10], pass: { end_location: [20, 10] } },
      { id: 'b', match_id: 7, type: { name: 'Pressure' }, team: { id: 2, name: 'B' }, player: { id: 21, name: '乙' }, location: [20, 10] }
    ], [{ team_id: 1, team_name: 'A', lineup: [{ player_id: 11, player_name: '甲', positions: [{ position: { name: 'Left Back' } }] }] }])
    expect(bundle.players.find(player => player.id === '11')?.position).toBe('Left Back')
  })
  it('仓库内的完整标准 JSON 示例可以直接导入', () => {
    const file = new URL('../../examples/demo-match-canonical.json', import.meta.url)
    const text = readFileSync(file, 'utf8')
    const bundle = parseCanonicalBundle(JSON.parse(text))
    expect(bundle.players).toHaveLength(22)
    expect(bundle.lineups).toHaveLength(22)
    expect(bundle.events).toHaveLength(30)
    expect(bundle.frames).toHaveLength(4)
    expect(bundle.players[0].id).toBe('1001')
  })
  it('完整示例通过桌面导入预览和事务提交前取数流程', async () => {
    const service = new ImportService()
    const preview = await service.preview(fileURLToPath(new URL('../../examples/demo-match-canonical.json', import.meta.url)))
    expect(preview).toMatchObject({ valid: true, format: 'canonical-json', playerCount: 22, eventCount: 30, frameCount: 4 })
    expect(service.take(preview.token).match.id).toBe('demo-canonical-2026-001')
  })
})
