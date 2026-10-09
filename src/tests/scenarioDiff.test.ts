import { describe, expect, it } from 'vitest'
import { createDemoScenario } from '../engine/demo'
import { describePlayerChanges, summarizeScenarioChanges } from '../engine/scenarioDiff'

describe('战术方案差异摘要', () => {
  it('相同方案不制造虚假的修改数量', () => {
    const scenario = createDemoScenario()
    expect(summarizeScenarioChanges(scenario, structuredClone(scenario))).toMatchObject({ total: 0, playerCount: 0, teamSettingCount: 0 })
  })

  it('分别统计球员调整和整体战术调整', () => {
    const baseline = createDemoScenario()
    const modified = structuredClone(baseline)
    modified.home[7].duty = '支援'
    modified.homeTactics.width += 4
    const summary = summarizeScenarioChanges(baseline, modified)
    expect(summary).toMatchObject({ total: 2, playerCount: 1, teamSettingCount: 1 })
    expect(summary.changedPlayerNames).toContain(modified.home[7].name)
    expect(describePlayerChanges(baseline.home[7], modified.home[7])).toContain('职责 进攻 → 支援')
  })
})
