import JSZip from 'jszip'
import type { CanonicalMatchBundle, ImportPreview, TacticalScenario } from '../types'
import { parseCanonicalBundle, parseTrackingCsv } from '../providers/canonical'
import { statsBombEventsToBundle } from '../providers/statsbomb'
import { validateScenario } from '../engine/simulation'

export const MAX_IMPORT_BYTES = 150 * 1024 * 1024
export const MAX_ZIP_FILES = 250
export const PREVIEW_TTL_MS = 15 * 60 * 1000

export interface ImportData { bundles: CanonicalMatchBundle[]; scenarios: TacticalScenario[] }
export interface BrowserImportFile { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }

function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown } catch { throw new Error('JSON 文件格式错误；请检查括号、逗号和编码后重新导入。') }
}

export function parseBrowserJson(value: unknown, sourceId: string): ImportData {
  if (Array.isArray(value) && value[0]?.type) return { bundles: [parseCanonicalBundle(statsBombEventsToBundle(value, [], [], sourceId))], scenarios: [] }
  if (value && typeof value === 'object' && 'format' in value && value.format === 'football-tactics-browser-backup') {
    const backup = value as { version?: unknown; matches?: unknown; scenarios?: unknown }
    if (backup.version !== 1 || !Array.isArray(backup.matches) || !Array.isArray(backup.scenarios)) throw new Error('浏览器备份版本或结构无效')
    const scenarios = backup.scenarios as TacticalScenario[]
    scenarios.forEach(scenario => { if (!scenario.id?.trim() || typeof scenario.name !== 'string') throw new Error('备份中的战术方案 ID 或名称无效'); validateScenario(scenario) })
    return { bundles: backup.matches.map(parseCanonicalBundle), scenarios }
  }
  return { bundles: Array.isArray(value) ? value.map(parseCanonicalBundle) : [parseCanonicalBundle(value)], scenarios: [] }
}

export function validateZipEntries(entries: Array<{ name: string; size?: number }>): void {
  if (entries.length > MAX_ZIP_FILES) throw new Error(`ZIP 文件数不能超过 ${MAX_ZIP_FILES} 个`)
  let total = 0
  for (const entry of entries) {
    if (/^(?:\/|\\|[a-z]:)/i.test(entry.name) || entry.name.replace(/\\/g, '/').split('/').includes('..')) throw new Error('ZIP 含不安全路径；请重新打包数据文件。')
    if (entry.size !== undefined) {
      if (!Number.isFinite(entry.size) || entry.size < 0) throw new Error('ZIP 文件大小信息无效')
      total += entry.size
      if (entry.size > MAX_IMPORT_BYTES || total > MAX_IMPORT_BYTES) throw new Error('ZIP 解压后数据不能超过 150 MB；请拆分数据包。')
    }
  }
}

async function parseZip(data: ArrayBuffer, name: string): Promise<ImportData> {
  let zip: JSZip
  try { zip = await JSZip.loadAsync(data) } catch { throw new Error('ZIP 文件损坏或不受支持，请重新导出数据包。') }
  const files = Object.values(zip.files).filter(file => !file.dir)
  validateZipEntries(files.map(file => ({ name: (file as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? file.name, size: (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize })))
  let expandedBytes = 0
  const readText = async (file: JSZip.JSZipObject): Promise<string> => {
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = []
      let fileBytes = 0, failed = false
      // JSZip exposes per-file streams at runtime; its bundled types omit this public method.
      const stream = (file as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array')
      stream.on('data', (chunk: Uint8Array) => {
        fileBytes += chunk.byteLength
        expandedBytes += chunk.byteLength
        if (fileBytes > MAX_IMPORT_BYTES || expandedBytes > MAX_IMPORT_BYTES) {
          failed = true; stream.pause(); reject(new Error('ZIP 解压后数据不能超过 150 MB；请拆分数据包。')); return
        }
        chunks.push(chunk)
      })
      stream.on('error', () => { failed = true; reject(new Error('ZIP 数据解压失败，请检查文件是否完整。')) })
      stream.on('end', () => {
        if (failed) return
        const output = new Uint8Array(fileBytes)
        let offset = 0
        chunks.forEach(chunk => { output.set(chunk, offset); offset += chunk.byteLength })
        resolve(output)
      })
      stream.resume()
    })
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error(`ZIP 中 ${file.name} 不是有效的 UTF-8 文本`) }
  }
  const canonical = files.find(file => /(?:canonical|backup).*\.json$/i.test(file.name))
  if (canonical) return parseBrowserJson(parseJson(await readText(canonical)), name)
  const eventFile = files.find(file => /(?:events?|match).*\.json$/i.test(file.name)) ?? files.find(file => /\.json$/i.test(file.name))
  if (!eventFile) {
    const csv = files.find(file => /\.csv$/i.test(file.name))
    if (csv) return { bundles: [parseCanonicalBundle(parseTrackingCsv(await readText(csv), csv.name))], scenarios: [] }
    throw new Error('ZIP 中未找到 JSON 或追踪 CSV 数据文件')
  }
  const events = parseJson(await readText(eventFile))
  if (!Array.isArray(events) || !events[0]?.type) return parseBrowserJson(events, name)
  const lineupFile = files.find(file => /lineups?.*\.json$/i.test(file.name))
  const frameFile = files.find(file => /(?:three-sixty|360|frames?).*\.json$/i.test(file.name))
  const lineups = lineupFile ? parseJson(await readText(lineupFile)) : []
  const frames = frameFile ? parseJson(await readText(frameFile)) : []
  if (!Array.isArray(lineups) || !Array.isArray(frames)) throw new Error('ZIP 中阵容或 360 快照必须为数组')
  return { bundles: [parseCanonicalBundle(statsBombEventsToBundle(events, lineups, frames, name))], scenarios: [] }
}

function imageBundle(name: string, bytes: Uint8Array, extension: string): CanonicalMatchBundle {
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if ((extension === 'png' && !png) || (extension !== 'png' && !jpeg)) throw new Error('图片内容与 PNG/JPG 扩展名不符或文件已损坏')
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  const id = `heatmap-${crypto.randomUUID()}`
  return {
    schemaVersion: 1, source: { provider: 'Local heatmap image', sourceId: name, importedAt: new Date().toISOString() },
    match: { id, competition: '参考资料', season: '未知', date: '', homeTeamId: 'home', awayTeamId: 'away' },
    teams: [{ id: 'home', name: '主队', color: '#19c37d' }, { id: 'away', name: '客队', color: '#ff7262' }],
    players: [], lineups: [], events: [], frames: [],
    heatmapReferences: [{ name, dataUrl: `data:${extension === 'png' ? 'image/png' : 'image/jpeg'};base64,${btoa(binary)}` }]
  }
}

async function validateImageDecoding(dataUrl: string): Promise<void> {
  // Header checks alone do not catch a truncated PNG/JPEG; verify the browser can decode it before offering a commit.
  if (typeof Image === 'undefined') return
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { image.src = ''; reject(new Error('热点图解码超时；请缩小图片尺寸后重试。')) }, 15_000)
    image.onload = () => {
      clearTimeout(timer)
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
        reject(new Error('热点图尺寸无效或超过 4000 万像素，请缩小图片后重试。'))
      } else resolve()
    }
    image.onerror = () => { clearTimeout(timer); reject(new Error('热点图已损坏，浏览器无法解码；请重新保存为 PNG/JPG 后导入。')) }
    image.src = dataUrl
  })
}

export class BrowserImportService {
  private pending = new Map<string, { data: ImportData; expiresAt: number }>()
  private generation = 0
  constructor(private readonly now: () => number = Date.now) {}

  private prune(): void {
    for (const [token, value] of this.pending) if (value.expiresAt <= this.now()) this.pending.delete(token)
  }

  async preview(file: BrowserImportFile): Promise<ImportPreview> {
    const generation = ++this.generation
    if (!file.name || file.size < 1) throw new Error('所选文件为空，请选择有效的比赛数据。')
    if (file.size > MAX_IMPORT_BYTES) throw new Error('导入文件不能超过 150 MB；请拆分比赛数据后重试。')
    this.prune()
    const extension = file.name.split('.').at(-1)?.toLowerCase()
    let data: ImportData, format: ImportPreview['format']
    if (extension === 'json') {
      const json = parseJson(await file.text())
      data = parseBrowserJson(json, file.name)
      format = Array.isArray(json) && json[0]?.type ? 'statsbomb-json' : 'canonical-json'
    } else if (extension === 'csv') {
      data = { bundles: [parseCanonicalBundle(parseTrackingCsv(await file.text(), file.name))], scenarios: [] }; format = 'tracking-csv'
    } else if (extension === 'zip') {
      data = await parseZip(await file.arrayBuffer(), file.name); format = 'zip'
    } else if (['png', 'jpg', 'jpeg'].includes(extension ?? '')) {
      const bundle = imageBundle(file.name, new Uint8Array(await file.arrayBuffer()), extension!)
      await validateImageDecoding(bundle.heatmapReferences![0].dataUrl!)
      data = { bundles: [bundle], scenarios: [] }; format = 'heatmap-image'
    } else throw new Error('仅支持 JSON、CSV、ZIP、PNG 和 JPG 文件')
    if (!data.bundles.length && !data.scenarios.length) throw new Error('数据包没有可导入的比赛或战术方案')
    if (generation !== this.generation) throw new Error('本次导入预览已被较新的文件选择替代，请使用最新预览。')
    // The application displays one preview. Retain only that preview instead of keeping many large parsed matches in memory.
    this.pending.clear()
    const token = crypto.randomUUID()
    this.pending.set(token, { data, expiresAt: this.now() + PREVIEW_TTL_MS })
    const eventCount = data.bundles.reduce((sum, bundle) => sum + bundle.events.length, 0)
    const frameCount = data.bundles.reduce((sum, bundle) => sum + bundle.frames.length, 0)
    const warnings: string[] = []
    if (!eventCount) warnings.push('没有事件数据；仅可用于追踪轨迹、基础资料或参考图分析。')
    if (!frameCount) warnings.push('没有逐帧追踪数据；无球跑位将由模型推断。')
    if (data.bundles.some(bundle => !bundle.match.date)) warnings.push('部分比赛日期缺失。')
    if (format === 'heatmap-image') warnings.push('热点图仅作参考叠加，不从图片反推坐标。')
    if (data.scenarios.length) warnings.push(`同时恢复 ${data.scenarios.length} 个已保存战术方案。`)
    return { fileName: file.name, format, valid: true, matchCount: data.bundles.length, playerCount: data.bundles.reduce((sum, bundle) => sum + bundle.players.length, 0), eventCount, frameCount, warnings, errors: [], token }
  }

  take(token: string): ImportData {
    this.prune()
    const value = this.pending.get(token)
    if (!value) throw new Error('导入预览已过期或已提交，请重新选择文件。')
    this.pending.delete(token)
    return value.data
  }
}

export function chooseImportFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json,.csv,.zip,.png,.jpg,.jpeg'; input.hidden = true
    let settled = false, timer: ReturnType<typeof setTimeout> | undefined
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      input.remove(); resolve(file)
    }
    const onFocus = () => { timer = setTimeout(() => finish(input.files?.[0] ?? null), 1000) }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    window.addEventListener('focus', onFocus)
    document.body.appendChild(input)
    input.click()
  })
}
