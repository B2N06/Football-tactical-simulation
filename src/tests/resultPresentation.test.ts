import { describe, expect, it } from 'vitest'
import { buildComparisonVerdict, presentComparisonMetrics } from '../engine/resultPresentation'
import type { SimulationComparison, SimulationResult } from '../types'

const result = (overrides: Partial<SimulationResult['metrics']> = {}): SimulationResult => ({
  scenarioId: 'scenario', seed: 7, createdAt: '2026-08-30T00:00:00.000Z',
  metrics: { possessions: 1200, shotRate: .15, averageXg: .02, boxEntries: .17, retentionRate: .2, averageProgression: 45, leftShare: .3, centreShare: .4, rightShare: .3, ...overrides },
  confidenceInterval: { shotRate: [.13, .17], retentionRate: [.18, .22] }, representativeSuccess: [], representativeFailure: [], playerHeatmaps: {}, passNetwork: [], qualityNotes: []
})

const comparison = (modified = result(), baseline = result()): SimulationComparison => ({
  baseline, modified,
  deltas: {
    shotRate: modified.metrics.shotRate - baseline.metrics.shotRate,
    averageXg: modified.metrics.averageXg - baseline.metrics.averageXg,
    boxEntries: modified.metrics.boxEntries - baseline.metrics.boxEntries,
    retentionRate: modified.metrics.retentionRate - baseline.metrics.retentionRate,
    averageProgression: modified.metrics.averageProgression - baseline.metrics.averageProgression
  }
})

describe('推演结果表达', () => {
  it('零差异显示为中性结论，不显示虚假提升', () => {
    const value = comparison()
    expect(presentComparisonMetrics(value).every(metric => metric.tone === 'neutral' && metric.deltaText === '无明显变化')).toBe(true)
    expect(buildComparisonVerdict(value, false).title).toBe('修改方案与基准方案一致')
  })

  it('同时存在改善和下降时明确表达为战术取舍', () => {
    const value = comparison(result({ shotRate: .17, retentionRate: .18 }))
    const verdict = buildComparisonVerdict(value, true)
    expect(verdict.tone).toBe('mixed')
    expect(verdict.title).toContain('取舍')
    expect(verdict.highlights.some(item => item.includes('射门回合率'))).toBe(true)
  })
})
