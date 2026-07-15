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
  it('防线高度、压迫与个人盯人会实际改变进攻结果', () => {
    const passive = createDemoScenario(); passive.iterations = 360
    passive.awayTactics.pressing = 0; passive.awayTactics.defensiveLine = 20
    passive.away.forEach(player => { player.pressIntensity = 0; player.marking = 0 })
    const aggressive = structuredClone(passive)
    aggressive.awayTactics.pressing = 100; aggressive.awayTactics.defensiveLine = 90
    aggressive.away.forEach(player => { player.pressIntensity = 100; player.marking = 100 })
    const passiveResult = simulateScenario(passive), aggressiveResult = simulateScenario(aggressive)
    expect(aggressiveResult.metrics.retentionRate).toBeLessThan(passiveResult.metrics.retentionRate)
    expect(aggressiveResult.metrics.averageProgression).not.toBe(passiveResult.metrics.averageProgression)
  })
  it('阵型宽度、纵深与组织方式会改变跑位和通道分布', () => {
    const narrow = createDemoScenario(); narrow.iterations = 240
    narrow.homeTactics.width = 10; narrow.homeTactics.depth = 20; narrow.homeTactics.buildUp = '短传组织'
    const wide = structuredClone(narrow)
    wide.homeTactics.width = 100; wide.homeTactics.depth = 90; wide.homeTactics.buildUp = '快速直接'
    const narrowResult = simulateScenario(narrow), wideResult = simulateScenario(wide)
    expect(wideResult.metrics.averageProgression).not.toBe(narrowResult.metrics.averageProgression)
    expect([wideResult.metrics.leftShare, wideResult.metrics.centreShare, wideResult.metrics.rightShare]).not.toEqual([narrowResult.metrics.leftShare, narrowResult.metrics.centreShare, narrowResult.metrics.rightShare])
  })
})
