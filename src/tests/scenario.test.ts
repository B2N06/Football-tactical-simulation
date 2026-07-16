import { describe, expect, it } from 'vitest'
import { createDemoScenario } from '../engine/demo'
import { getPlayerSide } from '../engine/scenario'

describe('战术方案球员归属', () => {
  it('通过阵容成员关系识别数字球员 ID，而不依赖名称前缀', () => {
    const scenario = createDemoScenario()
    scenario.home[0].playerId = '12345'
    scenario.away[0].playerId = '67890'
    expect(getPlayerSide(scenario, '12345')).toBe('home')
    expect(getPlayerSide(scenario, '67890')).toBe('away')
    expect(() => getPlayerSide(scenario, 'missing')).toThrow('不存在')
  })
})
