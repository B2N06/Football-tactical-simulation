import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserApi } from '../platform/browserApi'
import { BrowserDatabase } from '../platform/browserDatabase'
import { createBrowserDemoBundles } from '../platform/browserDemo'
import { createDemoScenario } from '../engine/demo'
import { simulateScenario } from '../engine/simulation'

const databases: BrowserDatabase[] = []
function createStore() { const db = new BrowserDatabase(`api-${crypto.randomUUID()}`, new IDBFactory()); databases.push(db); return db }
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.close())) })

describe('浏览器应用桥接', () => {
  it('无网络及无AI配置时仍能加载数据、保存战术、推演、导出与备份', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    const download = vi.fn(), print = vi.fn()
    const store = createStore()
    const api = createBrowserApi({ store, fetcher, download, print, chooseFile: async () => null })
    expect(await api.previewImport()).toBeNull()
    await api.seedDemo(); await api.seedDemo()
    expect((await api.listMatches())).toHaveLength(3)
    expect(await api.getTeamMatchBundles('demo-team-1', 'home')).toHaveLength(3)
    const scenario = createDemoScenario(); scenario.iterations = 5
    await api.saveScenario(scenario)
    const result = simulateScenario(scenario)
    const comparison = { baseline: result, modified: result, deltas: { shotRate: 0, averageXg: 0, boxEntries: 0, retentionRate: 0, averageProgression: 0 } }
    await api.exportResult('json', comparison)
    const report = await api.exportResult('pdf', comparison)
    expect(report.path).toContain('打印窗口')
    await api.backupDatabase()
    expect(fetcher).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledTimes(2)
    expect(print).toHaveBeenCalledTimes(1)
    expect(await api.getDatabaseSummary()).toMatchObject({ matches: 3, scenarios: 1 })
    expect(await api.getAppInfo()).toMatchObject({ platform: 'Browser', version: '0.7.0' })
  })

  it('Token仅用于同源代理且不写入数据库或备份，重新创建API需重新输入', async () => {
    const store = createStore(), download = vi.fn()
    const fetcher = vi.fn().mockImplementation(async (path: string) => new Response(JSON.stringify(path.includes('/matches/') ? { homeTeam: { id: 1, name: 'A' }, awayTeam: { id: 2, name: 'B' }, competition: { name: '联赛' }, utcDate: '2026-10-08T12:00:00Z', score: { fullTime: { home: 1, away: 0 } } } : { competitions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const api = createBrowserApi({ store, fetcher, download })
    expect(await api.saveFootballDataToken('test-token-123')).toMatchObject({ ok: true })
    await api.importFootballDataMatch('42')
    expect(fetcher.mock.calls[1][0]).toBe('/api/football-data/matches/42')
    expect(fetcher.mock.calls[1][1]).toMatchObject({ headers: { 'X-Auth-Token': 'test-token-123' }, credentials: 'omit', cache: 'no-store' })
    await api.backupDatabase()
    expect(download.mock.calls[0][1]).not.toContain('test-token-123')
    expect(JSON.stringify(await store.backup())).not.toContain('test-token-123')
    const reopened = createBrowserApi({ store, fetcher })
    await expect(reopened.importFootballDataMatch('42')).rejects.toThrow('请输入')
  })

  it('下载失败不触及已有数据，无效ID在发起请求前拒绝', async () => {
    const store = createStore()
    await store.importData([createBrowserDemoBundles()[0]])
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }))
    const api = createBrowserApi({ store, fetcher })
    await expect(api.importFootballDataMatch('../42', 'token')).rejects.toThrow('比赛 ID')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(api.importFootballDataMatch('42', 'token')).rejects.toThrow('过于频繁')
    expect((await api.getDatabaseSummary()).matches).toBe(1)
  })
})
