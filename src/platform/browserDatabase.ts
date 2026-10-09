import type { CanonicalMatchBundle, DatabaseSummary, StoredMatchSummary, TacticalScenario } from '../types'
import { parseCanonicalBundle } from '../providers/canonical'
import { validateScenario } from '../engine/simulation'

export interface BrowserBackup {
  format: 'football-tactics-browser-backup'
  version: 1
  createdAt: string
  matches: CanonicalMatchBundle[]
  scenarios: TacticalScenario[]
}

export interface BrowserStore {
  importData(bundles: CanonicalMatchBundle[], scenarios?: TacticalScenario[]): Promise<void>
  getAllBundles(): Promise<CanonicalMatchBundle[]>
  getMatchBundle(id: string): Promise<CanonicalMatchBundle>
  saveScenario(scenario: TacticalScenario): Promise<void>
  backup(): Promise<BrowserBackup>
}

export function summarizeBundles(bundles: CanonicalMatchBundle[], scenarioCount: number): DatabaseSummary {
  const teams = new Set<string>(), players = new Set<string>()
  let events = 0, frames = 0
  for (const bundle of bundles) {
    bundle.teams.forEach(team => teams.add(`${bundle.source.provider}:${team.id}`))
    bundle.players.forEach(player => players.add(`${bundle.source.provider}:${player.id}`))
    events += bundle.events.length
    frames += bundle.frames.length
  }
  return {
    matches: bundles.length, teams: teams.size, players: players.size, events, frames, scenarios: scenarioCount,
    lastImportedAt: bundles.map(bundle => bundle.source.importedAt).filter(Boolean).sort().at(-1)
  }
}

export function listBundleSummaries(bundles: CanonicalMatchBundle[]): StoredMatchSummary[] {
  return [...bundles].sort((a, b) => b.source.importedAt.localeCompare(a.source.importedAt)).map(bundle => ({
    id: bundle.match.id, competition: bundle.match.competition, season: bundle.match.season, date: bundle.match.date,
    homeTeam: bundle.teams.find(team => team.id === bundle.match.homeTeamId)?.name ?? '主队',
    awayTeam: bundle.teams.find(team => team.id === bundle.match.awayTeamId)?.name ?? '客队',
    eventCount: bundle.events.length, frameCount: bundle.frames.length, source: bundle.source.provider
  }))
}

export function relatedBundles(primary: CanonicalMatchBundle, bundles: CanonicalMatchBundle[]): CanonicalMatchBundle[] {
  const playerIds = new Set(primary.players.map(player => player.id))
  const related = bundles.filter(bundle => bundle.match.id !== primary.match.id && bundle.source.provider === primary.source.provider && bundle.players.some(player => playerIds.has(player.id)))
    .sort((a, b) => b.source.importedAt.localeCompare(a.source.importedAt)).slice(0, 19)
  return [primary, ...related]
}

export function teamBundles(primary: CanonicalMatchBundle, teamId: string, bundles: CanonicalMatchBundle[]): CanonicalMatchBundle[] {
  const participated = (bundle: CanonicalMatchBundle) => [bundle.match.homeTeamId, bundle.match.awayTeamId].includes(teamId)
  if (!participated(primary)) throw new Error('所选球队未参加基准比赛')
  const related = bundles.filter(bundle => bundle.match.id !== primary.match.id && bundle.source.provider === primary.source.provider && participated(bundle))
    .sort((a, b) => b.match.date.localeCompare(a.match.date) || b.source.importedAt.localeCompare(a.source.importedAt)).slice(0, 29)
  return [primary, ...related]
}

function databaseError(error: DOMException | Error | null): Error {
  if (error?.name === 'QuotaExceededError') return new Error('浏览器存储空间不足；请先下载备份并清理不需要的网站数据后重试。')
  return new Error(`浏览器数据库操作失败：${error?.message ?? '请确认浏览器允许此网站保存本地数据'}`)
}

export class BrowserDatabase implements BrowserStore {
  private connection?: Promise<IDBDatabase>
  constructor(private readonly name = 'football-tactics-browser', private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('当前浏览器不支持 IndexedDB；请使用新版 Edge、Chrome、Firefox 或 Safari。'))
    if (!this.connection) this.connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open(this.name, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('matches')) db.createObjectStore('matches', { keyPath: 'match.id' })
        if (!db.objectStoreNames.contains('scenarios')) db.createObjectStore('scenarios', { keyPath: 'id' })
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.connection = undefined }
        resolve(request.result)
      }
      request.onerror = () => { this.connection = undefined; reject(databaseError(request.error)) }
      request.onblocked = () => { this.connection = undefined; reject(new Error('数据库升级被另一个页面阻止；请关闭本工具的其他标签页后重试。')) }
    })
    return this.connection
  }

  private async readAll<T>(storeName: 'matches' | 'scenarios'): Promise<T[]> {
    const db = await this.open()
    return new Promise<T[]>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).getAll()
      let result: T[] = []
      request.onsuccess = () => { result = request.result as T[] }
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(databaseError(transaction.error))
      transaction.onerror = () => undefined
    })
  }

  async importData(bundles: CanonicalMatchBundle[], scenarios: TacticalScenario[] = []): Promise<void> {
    // Validate everything before opening the write transaction. A bad second match cannot partially import the first.
    const validated = bundles.map(bundle => parseCanonicalBundle(bundle))
    scenarios.forEach(scenario => {
      if (!scenario.id?.trim() || typeof scenario.name !== 'string') throw new Error('战术方案 ID 和名称无效')
      validateScenario(scenario)
    })
    const providers = new Map<string, string>()
    for (const bundle of validated) {
      const prior = providers.get(bundle.match.id)
      if (prior && prior !== bundle.source.provider) throw new Error(`比赛 ID ${bundle.match.id} 在数据包中对应不同来源；请为比赛使用独立 ID。`)
      providers.set(bundle.match.id, bundle.source.provider)
    }
    const db = await this.open()
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['matches', 'scenarios'], 'readwrite')
      const matches = transaction.objectStore('matches')
      let reason: Error | undefined
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(reason ?? databaseError(transaction.error))
      transaction.onerror = () => undefined
      try {
        for (const bundle of validated) {
          const lookup = matches.get(bundle.match.id)
          lookup.onsuccess = () => {
            const existing = lookup.result as CanonicalMatchBundle | undefined
            if (existing && existing.source.provider !== bundle.source.provider) {
              reason = new Error(`比赛 ID ${bundle.match.id} 已被另一数据来源使用，未写入任何数据。请修改导入比赛的 ID。`)
              transaction.abort()
              return
            }
            try { matches.put(bundle) } catch (error) {
              reason = error instanceof Error ? error : new Error(String(error))
              transaction.abort()
            }
          }
        }
        const scenarioStore = transaction.objectStore('scenarios')
        scenarios.forEach(scenario => scenarioStore.put(scenario))
      } catch (error) {
        reason = error instanceof Error ? error : new Error(String(error))
        transaction.abort()
      }
    })
  }

  getAllBundles(): Promise<CanonicalMatchBundle[]> { return this.readAll<CanonicalMatchBundle>('matches') }

  async getMatchBundle(id: string): Promise<CanonicalMatchBundle> {
    const db = await this.open()
    return new Promise<CanonicalMatchBundle>((resolve, reject) => {
      const transaction = db.transaction('matches', 'readonly')
      const request = transaction.objectStore('matches').get(id)
      let bundle: CanonicalMatchBundle | undefined
      request.onsuccess = () => { bundle = request.result as CanonicalMatchBundle | undefined }
      transaction.oncomplete = () => bundle ? resolve(bundle) : reject(new Error('比赛不存在或已被删除'))
      transaction.onabort = () => reject(databaseError(transaction.error))
      transaction.onerror = () => undefined
    })
  }

  async saveScenario(scenario: TacticalScenario): Promise<void> { await this.importData([], [scenario]) }

  async close(): Promise<void> {
    if (this.connection) (await this.connection).close()
    this.connection = undefined
  }

  async backup(): Promise<BrowserBackup> {
    const db = await this.open()
    // Both stores are read in one snapshot so the backup cannot mix different write transactions.
    return new Promise<BrowserBackup>((resolve, reject) => {
      const transaction = db.transaction(['matches', 'scenarios'], 'readonly')
      const matches = transaction.objectStore('matches').getAll(), scenarios = transaction.objectStore('scenarios').getAll()
      transaction.oncomplete = () => resolve({ format: 'football-tactics-browser-backup', version: 1, createdAt: new Date().toISOString(), matches: matches.result as CanonicalMatchBundle[], scenarios: scenarios.result as TacticalScenario[] })
      transaction.onabort = () => reject(databaseError(transaction.error))
      transaction.onerror = () => undefined
    })
  }
}
