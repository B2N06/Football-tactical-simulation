import { describe, expect, it } from 'vitest'
import { comparisonCsv, comparisonReportHtml } from '../platform/browserExport'
import { createDemoScenario } from '../engine/demo'
import { simulateScenario } from '../engine/simulation'
import type { SimulationComparison } from '../types'

function comparison(): SimulationComparison {
  const scenario = createDemoScenario(); scenario.iterations = 5
  const result = simulateScenario(scenario)
  result.qualityNotes.push('<script>alert("unsafe")</script>')
  return { baseline: result, modified: result, deltas: { shotRate: 0, averageXg: 0, boxEntries: 0, retentionRate: 0, averageProgression: 0 } }
}

describe('浏览器结果导出', () => {
  it('打印报告使用可读单位和中性结果，并转义导入数据中的HTML', () => {
    const html = comparisonReportHtml(comparison())
    expect(html).toContain('无明显变化')
    expect(html).toContain('另存为 PDF')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain("default-src 'none'")
  })

  it('CSV为表格保留数值、BOM和基准/修改/变化列', () => {
    const csv = comparisonCsv(comparison())
    expect(csv).toMatch(/^\uFEFFmetric,baseline,modified,delta\r\n/)
    expect(csv.split('\r\n')).toHaveLength(6)
    expect(csv).toContain('averageXg,')
  })
})
