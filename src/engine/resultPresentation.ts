import type { SimulationComparison } from '../types'

export type ResultTone = 'positive' | 'negative' | 'mixed' | 'neutral'

export interface ComparisonMetricPresentation {
  key: string
  label: string
  modified: string
  baseline: string
  deltaText: string
  tone: Exclude<ResultTone, 'mixed'>
  magnitude: number
}

export interface ComparisonVerdict {
  tone: ResultTone
  title: string
  summary: string
  highlights: string[]
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const signed = (value: number, digits: number, suffix = '') => `${value > 0 ? '+' : ''}${value.toFixed(digits)}${suffix}`

function tone(delta: number, threshold: number): Exclude<ResultTone, 'mixed'> {
  if (Math.abs(delta) <= threshold) return 'neutral'
  return delta > 0 ? 'positive' : 'negative'
}

export function presentComparisonMetrics(comparison: SimulationComparison): ComparisonMetricPresentation[] {
  const rows = [
    {
      key: 'shotRate', label: '射门回合率', modified: percent(comparison.modified.metrics.shotRate), baseline: percent(comparison.baseline.metrics.shotRate),
      delta: comparison.deltas.shotRate, threshold: .001, deltaText: signed(comparison.deltas.shotRate * 100, 1, ' 个百分点')
    },
    {
      key: 'averageXg', label: '每回合平均 xG', modified: comparison.modified.metrics.averageXg.toFixed(4), baseline: comparison.baseline.metrics.averageXg.toFixed(4),
      delta: comparison.deltas.averageXg, threshold: .0005, deltaText: signed(comparison.deltas.averageXg, 4)
    },
    {
      key: 'boxEntries', label: '每回合禁区进入', modified: comparison.modified.metrics.boxEntries.toFixed(2), baseline: comparison.baseline.metrics.boxEntries.toFixed(2),
      delta: comparison.deltas.boxEntries, threshold: .005, deltaText: signed(comparison.deltas.boxEntries, 2)
    },
    {
      key: 'retentionRate', label: '控球延续率', modified: percent(comparison.modified.metrics.retentionRate), baseline: percent(comparison.baseline.metrics.retentionRate),
      delta: comparison.deltas.retentionRate, threshold: .001, deltaText: signed(comparison.deltas.retentionRate * 100, 1, ' 个百分点')
    },
    {
      key: 'averageProgression', label: '平均推进距离', modified: `${comparison.modified.metrics.averageProgression.toFixed(1)}m`, baseline: `${comparison.baseline.metrics.averageProgression.toFixed(1)}m`,
      delta: comparison.deltas.averageProgression, threshold: .1, deltaText: signed(comparison.deltas.averageProgression, 1, 'm')
    }
  ]

  return rows.map(row => ({
    key: row.key,
    label: row.label,
    modified: row.modified,
    baseline: row.baseline,
    deltaText: tone(row.delta, row.threshold) === 'neutral' ? '无明显变化' : row.deltaText,
    tone: tone(row.delta, row.threshold),
    magnitude: Math.abs(row.delta) / row.threshold
  }))
}

export function buildComparisonVerdict(comparison: SimulationComparison, hasScenarioChanges: boolean): ComparisonVerdict {
  const metrics = presentComparisonMetrics(comparison)
  const material = metrics.filter(metric => metric.tone !== 'neutral').sort((a, b) => b.magnitude - a.magnitude)
  const positive = material.filter(metric => metric.tone === 'positive').length
  const negative = material.filter(metric => metric.tone === 'negative').length
  const highlights = material.slice(0, 3).map(metric => `${metric.label} ${metric.deltaText}`)

  if (!material.length) {
    return {
      tone: 'neutral',
      title: hasScenarioChanges ? '本轮没有出现可解释的指标差异' : '修改方案与基准方案一致',
      summary: hasScenarioChanges
        ? '已检测到战术调整，但关键指标差异低于当前显示阈值。建议增加推演次数，或扩大单次战术调整后再复核。'
        : '当前没有战术参数变化，因此两组固定种子推演得到一致结果。这是基准校验，不代表战术方案已被优化。',
      highlights: hasScenarioChanges ? ['差异低于显示阈值', '结论暂不支持方向性判断'] : ['未检测到球员或整体战术调整', '固定随机种子校验通过']
    }
  }

  const toneValue: ResultTone = positive && negative ? 'mixed' : positive ? 'positive' : 'negative'
  const title = toneValue === 'mixed' ? '修改方案呈现进攻取舍' : toneValue === 'positive' ? '修改方案在本轮样本中占优' : '修改方案在本轮样本中表现下降'
  const summary = toneValue === 'mixed'
    ? '部分进攻指标改善，同时另一些指标下降。请结合战术目的和回合回放判断这种取舍是否可接受。'
    : toneValue === 'positive'
      ? '多数达到显示阈值的指标朝积极方向变化。结果仍是概率分析，应结合置信区间和代表性回合复核。'
      : '多数达到显示阈值的指标朝不利方向变化。建议检查职责、站位与传球倾向是否造成空间或连接损失。'

  return { tone: toneValue, title, summary, highlights }
}
