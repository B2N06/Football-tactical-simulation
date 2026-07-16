import { describe, expect, it } from 'vitest'
import { createDemoScenario } from '../engine/demo'
import { compareScenarios, simulateScenario, validateScenario } from '../engine/simulation'

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
    expect(Object.keys(result.playerHeatmaps)).toHaveLength(22)
    expect(result.playerHeatmaps['away-9'].length).toBeGreaterThan(0)
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
  it('门将扑救和一对一能力会降低对方机会质量', () => {
    const weakGoalkeeper = createDemoScenario(); weakGoalkeeper.iterations = 420
    const strongGoalkeeper = structuredClone(weakGoalkeeper)
    weakGoalkeeper.away[0].goalkeeping = { shotStopping: 0, handling: 50, aerialReach: 50, oneOnOnes: 0, rushingOut: 50, distribution: 50 }
    strongGoalkeeper.away[0].goalkeeping = { shotStopping: 100, handling: 50, aerialReach: 50, oneOnOnes: 100, rushingOut: 50, distribution: 50 }
    const weakResult = simulateScenario(weakGoalkeeper), strongResult = simulateScenario(strongGoalkeeper)
    expect(strongResult.metrics.averageXg).toBeLessThan(weakResult.metrics.averageXg)
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
  it('客队持球时向左侧球门推进并正确计算跑位方向', () => {
    const scenario = createDemoScenario(); scenario.iterations = 180; scenario.possession = 'away'; scenario.startingBall = { x: 87, y: 34 }
    const result = simulateScenario(scenario)
    const striker = scenario.away.find(player => player.playerId === 'away-9')!
    const sampledX = result.playerHeatmaps[striker.playerId].map(point => point.x)
    expect(sampledX.reduce((sum, value) => sum + value, 0) / sampledX.length).toBeLessThan(striker.anchor.x)
    const shots = [...result.representativeSuccess, ...result.representativeFailure].filter(action => action.kind === 'shot')
    expect(shots.every(action => action.end.x === 0)).toBe(true)
    expect(result.metrics.averageProgression).toBeGreaterThan(0)
  })
  it('拒绝越界属性和过大的回合动作数', () => {
    const scenario = createDemoScenario(); scenario.home[0].attributes.passing = 101
    expect(() => validateScenario(scenario)).toThrow('0–100')
    scenario.home[0].attributes.passing = 70; scenario.maxActions = 51
    expect(() => validateScenario(scenario)).toThrow('1–50')
  })

  it('报告基准与修改方案的单调后台进度', () => {
    const scenario = createDemoScenario(); scenario.iterations = 40
    const updates: Array<{ progress: number; phase: string }> = []
    compareScenarios(scenario, structuredClone(scenario), (progress, phase) => updates.push({ progress, phase }))
    expect(updates[0]).toMatchObject({ phase: 'baseline' })
    expect(updates.at(-1)).toEqual({ progress: 1, phase: 'modified' })
    expect(updates.every((item, index) => index === 0 || item.progress >= updates[index - 1].progress)).toBe(true)
  })

  it('拒绝用不同样本数或随机种子进行不公平对比', () => {
    const baseline = createDemoScenario(), modified = structuredClone(baseline)
    modified.iterations += 1
    expect(() => compareScenarios(baseline, modified)).toThrow('相同推演次数')
    modified.iterations = baseline.iterations; modified.seed += 1
    expect(() => compareScenarios(baseline, modified)).toThrow('相同随机种子')
  })
})
