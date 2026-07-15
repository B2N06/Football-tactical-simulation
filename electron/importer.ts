import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import JSZip from 'jszip'
import type { CanonicalMatchBundle, ImportPreview } from '../src/types'
import { parseCanonicalBundle, parseTrackingCsv } from '../src/providers/canonical'
import { statsBombEventsToBundle } from '../src/providers/statsbomb'

export class ImportService {
  private pending = new Map<string, { bundle: CanonicalMatchBundle; expiresAt: number }>()
  private static readonly maxFileBytes = 150 * 1024 * 1024
  private static readonly previewTtlMs = 15 * 60 * 1000

  private prune(): void {
    const now = Date.now()
    for (const [token, item] of this.pending) if (item.expiresAt <= now) this.pending.delete(token)
    while (this.pending.size >= 8) this.pending.delete(this.pending.keys().next().value!)
  }

  async preview(filePath: string): Promise<ImportPreview> {
    const fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) throw new Error('请选择一个有效的数据文件')
    if (fileInfo.size > ImportService.maxFileBytes) throw new Error('导入文件不能超过 150 MB；请拆分比赛数据后重试')
    this.prune()
    const extension = extname(filePath).toLowerCase()
    const name = basename(filePath)
    let bundle: CanonicalMatchBundle
    let format: ImportPreview['format']
    if (['.png', '.jpg', '.jpeg'].includes(extension)) {
      const data = await readFile(filePath)
      const mime = extension === '.png' ? 'image/png' : 'image/jpeg'
      bundle = this.imageBundle(name, `data:${mime};base64,${data.toString('base64')}`)
      format = 'heatmap-image'
    } else if (extension === '.csv') {
      bundle = parseTrackingCsv(await readFile(filePath, 'utf8'), name)
      format = 'tracking-csv'
    } else if (extension === '.zip') {
      bundle = await this.parseZip(await readFile(filePath), name)
      format = 'zip'
    } else if (extension === '.json') {
      const value = JSON.parse(await readFile(filePath, 'utf8'))
      if (Array.isArray(value) && value[0]?.type) { bundle = statsBombEventsToBundle(value, [], [], name); format = 'statsbomb-json' }
      else { bundle = parseCanonicalBundle(value); format = 'canonical-json' }
    } else throw new Error('仅支持 JSON、CSV、ZIP、PNG 和 JPG 文件')
    const token = randomUUID()
    this.pending.set(token, { bundle, expiresAt: Date.now() + ImportService.previewTtlMs })
    const warnings: string[] = []
    if (!bundle.events.length) warnings.push('没有事件数据；仅可用于轨迹或参考图分析。')
    if (!bundle.frames.length) warnings.push('没有逐帧追踪数据；无球跑位将由模型推断。')
    if (!bundle.match.date) warnings.push('比赛日期缺失。')
    return { fileName: name, format, valid: true, matchCount: 1, playerCount: bundle.players.length, eventCount: bundle.events.length, frameCount: bundle.frames.length, warnings, errors: [], token }
  }

  take(token: string): CanonicalMatchBundle {
    this.prune()
    const pending = this.pending.get(token)
    if (!pending) throw new Error('导入预览已过期，请重新选择文件')
    this.pending.delete(token)
    return pending.bundle
  }

  private async parseZip(data: Buffer, name: string): Promise<CanonicalMatchBundle> {
    const zip = await JSZip.loadAsync(data)
    const files = Object.values(zip.files).filter(file => !file.dir)
    const canonical = files.find(file => /canonical.*\.json$/i.test(file.name))
    if (canonical) return parseCanonicalBundle(JSON.parse(await canonical.async('string')))
    const eventFile = files.find(file => /(?:events?|match).*\.json$/i.test(file.name)) ?? files.find(file => file.name.endsWith('.json'))
    if (!eventFile) throw new Error('ZIP 中未找到 JSON 数据')
    const lineupFile = files.find(file => /lineups?.*\.json$/i.test(file.name))
    const frameFile = files.find(file => /(?:three-sixty|360|frames?).*\.json$/i.test(file.name))
    return statsBombEventsToBundle(JSON.parse(await eventFile.async('string')), lineupFile ? JSON.parse(await lineupFile.async('string')) : [], frameFile ? JSON.parse(await frameFile.async('string')) : [], name)
  }

  private imageBundle(name: string, dataUrl: string): CanonicalMatchBundle {
    const id = `heatmap-${randomUUID()}`
    return {
      schemaVersion: 1, source: { provider: 'Local heatmap image', sourceId: name, importedAt: new Date().toISOString() },
      match: { id, competition: '参考资料', season: '未知', date: '', homeTeamId: 'home', awayTeamId: 'away' },
      teams: [{ id: 'home', name: '主队', color: '#19c37d' }, { id: 'away', name: '客队', color: '#ff7262' }],
      players: [], lineups: [], events: [], frames: [], heatmapReferences: [{ name, dataUrl }]
    }
  }
}
