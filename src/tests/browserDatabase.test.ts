import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserDatabase, relatedBundles, summarizeBundles, teamBundles } from '../platform/browserDatabase'
import { createBrowserDemoBundles } from '../platform/browserDemo'
import { createDemoScenario } from '../engine/demo'

const databases: BrowserDatabase[] = []
function database(factory = new IDBFactory()) {
  const db = new BrowserDatabase(`test-${crypto.randomUUID()}`, factory)
  databases.push(db)
  return db
}
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.close())) })

describe('浏览器IndexedDB持久化', () => {
  it('原子导入并去重，重新打开仍保持比赛和方案', async () => {
    const factory = new IDBFactory(), name = `persistent-${crypto.randomUUID()}`
    const db = new BrowserDatabase(name, factory); databases.push(db)
    const bundles = createBrowserDemoBundles()
    await db.importData(bundles, [createDemoScenario()])
    await db.importData([bundles[0]])
    expect(summarizeBundles(await db.getAllBundles(), (await db.backup()).scenarios.length)).toMatchObject({ matches: 3, teams: 2, players: 22, scenarios: 1 })
    await db.close()
    const reopened = new BrowserDatabase(name, factory); databases.push(reopened)
    expect((await reopened.getMatchBundle('demo-team-1')).events).toHaveLength(18)
    expect((await reopened.backup()).scenarios[0].name).toContain('后场组织')
  })

  it('不同来源ID冲突会回滚已排队的其他比赛和方案，保护原有数据', async () => {
    const db = database()
    const bundles = createBrowserDemoBundles()
    await db.importData([bundles[0]])
    const collision = structuredClone(bundles[0]); collision.source.provider = 'another-provider'
    await expect(db.importData([bundles[1], collision], [createDemoScenario()])).rejects.toThrow('另一数据来源')
    const backup = await db.backup()
    expect(backup.matches.map(bundle => bundle.match.id)).toEqual(['demo-team-1'])
    expect(backup.scenarios).toHaveLength(0)
    expect(backup.matches[0].source.provider).toBe('内置合成示例')
  })

  it('批量中任一无效坐标都阻止整个导入', async () => {
    const db = database()
    const bundles = createBrowserDemoBundles()
    bundles[1].events[0].start.x = 106
    await expect(db.importData(bundles)).rejects.toThrow('标准数据格式无效')
    expect(await db.getAllBundles()).toEqual([])
  })

  it('球队与球员历史严格隔离数据来源并拒绝非参赛球队', () => {
    const bundles = createBrowserDemoBundles()
    const other = structuredClone(bundles[1]); other.match.id = 'other'; other.source.provider = 'other'
    expect(relatedBundles(bundles[0], [...bundles, other])).toHaveLength(3)
    expect(teamBundles(bundles[0], 'home', [...bundles, other]).map(bundle => bundle.match.id)).toEqual(['demo-team-1', 'demo-team-3', 'demo-team-2'])
    expect(() => teamBundles(bundles[0], 'missing', bundles)).toThrow('未参加')
  })
})
