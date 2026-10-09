import type { CanonicalMatchBundle, DesktopApi } from '../types'
import { parseCanonicalBundle } from '../providers/canonical'
import { fetchStatsBombOpenMatch } from '../providers/statsbomb'
import { BrowserDatabase, listBundleSummaries, relatedBundles, summarizeBundles, teamBundles, type BrowserStore } from './browserDatabase'
import { BrowserImportService, chooseImportFile, type BrowserImportFile } from './browserImport'
import { createBrowserDemoBundles } from './browserDemo'
import { comparisonCsv, comparisonReportHtml, downloadBrowserFile, openPrintableReport } from './browserExport'

export interface BrowserApiOptions {
  store?: BrowserStore
  imports?: BrowserImportService
  chooseFile?: () => Promise<BrowserImportFile | null>
  fetcher?: typeof fetch
  download?: typeof downloadBrowserFile
  print?: typeof openPrintableReport
  fetchStatsBomb?: typeof fetchStatsBombOpenMatch
}

function validateToken(value: string): string {
  const token = value.trim()
  if (!token) throw new Error('请输入 football-data.org API Token')
  if (token.length > 512 || /[\r\n]/.test(token)) throw new Error('API Token 格式无效')
  return token
}

export function createBrowserApi(options: BrowserApiOptions = {}): DesktopApi {
  const store = options.store ?? new BrowserDatabase()
  const imports = options.imports ?? new BrowserImportService()
  const chooseFile = options.chooseFile ?? chooseImportFile
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const download = options.download ?? downloadBrowserFile
  const print = options.print ?? openPrintableReport
  const statsBomb = options.fetchStatsBomb ?? fetchStatsBombOpenMatch
  // API keys only live in this page's memory. No localStorage, IndexedDB or browser-backup entry receives a key.
  let sessionToken = ''
  const summary = async () => { const backup = await store.backup(); return summarizeBundles(backup.matches, backup.scenarios.length) }
  const footballData = async (path: string, token: string): Promise<unknown> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetcher(`/api/football-data/${path}`, { headers: { 'X-Auth-Token': validateToken(token), Accept: 'application/json' }, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' })
      if (response.status === 401 || response.status === 403) throw new Error('Token 无效或订阅无权访问该资料')
      if (response.status === 429) throw new Error('数据源请求过于频繁，请稍后重试。')
      if (response.status === 404 || response.status === 405) throw new Error('比赛不存在或当前站点尚未配置 football-data.org 代理。')
      if (!response.ok) throw new Error(`football-data.org 下载失败：HTTP ${response.status}`)
      return await response.json() as unknown
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('数据源请求超时，请检查网络后重试。')
      if (error instanceof TypeError) throw new Error('无法连接数据源代理，请检查网络或稍后重试。')
      throw error
    } finally { clearTimeout(timer) }
  }

  const importBundle = async (bundle: CanonicalMatchBundle, message: string) => {
    await store.importData([parseCanonicalBundle(bundle)])
    return { ok: true, message, summary: await summary() }
  }

  return {
    getDatabaseSummary: summary,
    listMatches: async () => listBundleSummaries(await store.getAllBundles()),
    getMatchBundle: id => store.getMatchBundle(id),
    getRelatedMatchBundles: async id => relatedBundles(await store.getMatchBundle(id), await store.getAllBundles()),
    getTeamMatchBundles: async (id, teamId) => teamBundles(await store.getMatchBundle(id), teamId, await store.getAllBundles()),
    previewImport: async () => { const file = await chooseFile(); return file ? imports.preview(file) : null },
    commitImport: async token => {
      const data = imports.take(token)
      await store.importData(data.bundles, data.scenarios)
      return { ok: true, message: `${data.bundles.length} 场比赛${data.scenarios.length ? `及 ${data.scenarios.length} 个战术方案` : ''}已通过校验并原子导入到本浏览器。`, summary: await summary() }
    },
    seedDemo: async () => {
      await store.importData(createBrowserDemoBundles())
      return { ok: true, message: '3 场球队级合成示例已写入本浏览器；重复加载会更新示例，不会产生重复比赛。', summary: await summary() }
    },
    importStatsBombOpen: async id => {
      const bundle = await statsBomb(id.trim())
      return importBundle(bundle, `已导入 StatsBomb 比赛 ${id}，包含 ${bundle.events.length} 个事件和 ${bundle.frames.length} 个空间快照。`)
    },
    importFootballDataMatch: async (id, token) => {
      const matchId = id.trim()
      if (!/^\d{1,20}$/.test(matchId)) throw new Error('football-data.org 比赛 ID 必须为数字')
      const data = await footballData(`matches/${matchId}`, token?.trim() || sessionToken)
      const { footballDataMatchToBundle } = await import('../providers/footballData')
      const bundle = footballDataMatchToBundle(data, matchId)
      return importBundle(bundle, `已导入 ${bundle.teams[0].name} 对 ${bundle.teams[1].name} 的比赛资料；此数据源不含逐帧跑位。`)
    },
    testFootballData: async token => {
      try { await footballData('competitions?limit=1', token); return { ok: true, message: '连接成功，football-data.org v4 可用。' } }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : '连接测试失败，请稍后重试。' } }
    },
    saveFootballDataToken: async token => {
      try {
        const value = validateToken(token)
        await footballData('competitions?limit=1', value)
        sessionToken = value
        return { ok: true, message: 'Token 已验证，仅保存在当前页面内存；刷新或关闭页面后需重新输入。' }
      } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Token 验证失败。' } }
    },
    saveScenario: async scenario => { await store.saveScenario(scenario); return { ok: true } },
    exportResult: async (format, comparison) => {
      if (format === 'pdf') {
        print(comparisonReportHtml(comparison))
        return { ok: true, path: '打印窗口（可选择另存为 PDF）' }
      }
      const name = `tactical-comparison-${new Date().toISOString().slice(0, 10)}.${format}`
      if (format === 'json') download(name, JSON.stringify(comparison, null, 2), 'application/json;charset=utf-8')
      else download(name, comparisonCsv(comparison), 'text/csv;charset=utf-8')
      return { ok: true, path: name }
    },
    backupDatabase: async () => {
      const name = `football-tactics-backup-${new Date().toISOString().slice(0, 10)}.json`
      download(name, JSON.stringify(await store.backup(), null, 2), 'application/json;charset=utf-8')
      return { ok: true, path: name }
    },
    getAppInfo: async () => ({ version: '0.7.0', databasePath: '本浏览器的 IndexedDB（仅保存在此设备，可下载 JSON 备份）', platform: 'Browser' })
  }
}
