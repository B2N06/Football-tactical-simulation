import type { SimulationComparison } from '../types'
import { presentComparisonMetrics } from '../engine/resultPresentation'

export function escapeReportHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function comparisonCsv(comparison: SimulationComparison): string {
  const keys = Object.keys(comparison.deltas) as Array<keyof SimulationComparison['deltas']>
  return '\uFEFF' + ['metric,baseline,modified,delta', ...keys.map(key => `${key},${comparison.baseline.metrics[key]},${comparison.modified.metrics[key]},${comparison.deltas[key]}`)].join('\r\n')
}

export function comparisonReportHtml(comparison: SimulationComparison): string {
  const metrics = presentComparisonMetrics(comparison)
  const rows = metrics.map(metric => `<tr><th scope="row">${escapeReportHtml(metric.label)}</th><td>${escapeReportHtml(metric.baseline)}</td><td>${escapeReportHtml(metric.modified)}</td><td>${escapeReportHtml(metric.deltaText)}</td></tr>`).join('')
  const notes = [...new Set([...comparison.baseline.qualityNotes, ...comparison.modified.qualityNotes])].map(note => `<li>${escapeReportHtml(note)}</li>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>足球战术推演对比报告</title><style>
  body{font:15px/1.65 system-ui,sans-serif;color:#172d25;background:#fff;max-width:900px;margin:32px auto;padding:24px}h1{font-size:26px}h2{font-size:18px;margin-top:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd7cf;padding:10px;text-align:left}small,p.note{color:#59685f}@media print{body{padding:0;margin:0;max-width:none}h2,table{break-inside:avoid}}@page{size:A4;margin:20mm}
  </style></head><body><small>MOSSNYX / FOOTBALL TACTICAL SIMULATION</small><h1>战术推演对比报告</h1><p>生成时间：${escapeReportHtml(new Date(comparison.modified.createdAt).toLocaleString('zh-CN'))}<br>基准回合数：${comparison.baseline.metrics.possessions} · 修改回合数：${comparison.modified.metrics.possessions}<br>随机种子：${comparison.modified.seed}</p><table><thead><tr><th>指标</th><th>基准方案</th><th>修改方案</th><th>变化</th></tr></thead><tbody>${rows}</tbody></table><h2>95% 蒙特卡洛置信区间</h2><p>基准射门回合率：${comparison.baseline.confidenceInterval.shotRate.map(value => `${(value * 100).toFixed(1)}%`).join(' – ')}<br>修改射门回合率：${comparison.modified.confidenceInterval.shotRate.map(value => `${(value * 100).toFixed(1)}%`).join(' – ')}<br>基准控球延续率：${comparison.baseline.confidenceInterval.retentionRate.map(value => `${(value * 100).toFixed(1)}%`).join(' – ')}<br>修改控球延续率：${comparison.modified.confidenceInterval.retentionRate.map(value => `${(value * 100).toFixed(1)}%`).join(' – ')}</p><h2>数据质量与模型说明</h2><ul>${notes}</ul><p class="note">本报告为概率分析；显示阈值不等同于统计显著性。模型不构成真实比赛预测，核心计算未使用 AI。浏览器可在打印选项中选择“另存为 PDF”。</p></body></html>`
}

export function downloadBrowserFile(name: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement('a')
  link.href = url; link.download = name; link.hidden = true
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function openPrintableReport(html: string): void {
  const report = window.open('', '_blank')
  if (!report) throw new Error('浏览器拦截了报告窗口；请允许此网站弹出窗口后重试。')
  report.opener = null
  report.document.open(); report.document.write(html); report.document.close()
  report.focus()
  setTimeout(() => { if (!report.closed) report.print() }, 250)
}
