import { describe, expect, it } from 'vitest'
import { createDemoScenario } from '../engine/demo'
import { compareScenarios, simulateScenario } from '../engine/simulation'

describe('蒙特卡洛战术推演', () => {
  it('同一随机种子产生可复现结果', () => {
    const scenario = createDemoScenario(); scenario.iterations = 150
    const first = simulateScenario(scenario), second = simulateScenario(scenario)
    expect(first.metrics).toEqual(second.metrics)
    expect(first.representativeSuccess).toEqual(second.representativeSuccess)
    expect(first.passNetwork).toEqual(second.passNetwork)
  })
  it('球员职责改变会改变结果分布', () => {
    const baseline = createDemoScenario(); baseline.iterations = 240
    const modified = structuredClone(baseline)
    const player = modified.home.find(item => item.playerId === 'home-10')!
    player.duty = '进攻'; player.runPattern = '前插'; player.passForward = 100; player.shootTendency = 100
    const result = compareScenarios(baseline, modified)
    expect(Object.values(result.deltas).some(value => Math.abs(value) > 0.0001)).toBe(true)
  })
  it('输出概率、置信区间和解释说明', () => {
    const scenario = createDemoScenario(); scenario.iterations = 80
    const result = simulateScenario(scenario)
    expect(result.metrics.shotRate).toBeGreaterThanOrEqual(0)
    expect(result.metrics.shotRate).toBeLessThanOrEqual(1)
    expect(result.confidenceInterval.shotRate[0]).toBeLessThanOrEqual(result.confidenceInterval.shotRate[1])
    expect(result.qualityNotes.join('')).toContain('概率模型')
  })
})
