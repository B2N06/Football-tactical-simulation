import { describe, expect, it } from 'vitest'
import { statsBombEventsToBundle } from '../providers/statsbomb'
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
})
