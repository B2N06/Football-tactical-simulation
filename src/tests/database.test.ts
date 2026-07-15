import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TacticalDatabase } from '../../electron/database'
import type { CanonicalMatchBundle } from '../types'

const tempPaths: string[] = []
afterEach(async () => { await Promise.all(tempPaths.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function bundle(id = 'db-test'): CanonicalMatchBundle {
  return {
    schemaVersion: 1, source: { provider: 'test', sourceId: id, importedAt: new Date().toISOString() },
    match: { id, competition: '测试赛事', season: '2026', date: '2026-07-15', homeTeamId: 'a', awayTeamId: 'b' },
    teams: [{ id: 'a', name: 'A', color: '#0f0' }, { id: 'b', name: 'B', color: '#f00' }],
    players: [{ id: 'p1', name: '球员', teamId: 'a', shirtNumber: 1, position: '门将' }],
    lineups: [{ teamId: 'a', playerId: 'p1', starter: true }],
    events: [{ id: 'e1', matchId: id, period: 1, second: 1, teamId: 'a', playerId: 'p1', kind: 'pass', start: { x: 1, y: 1 }, end: { x: 2, y: 2 }, outcome: 'success' }],
    frames: []
  }
}

describe('SQLite 持久化', () => {
  it('事务导入、替换去重和重新打开后均保持一致', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fts-db-')); tempPaths.push(directory)
    const path = join(directory, 'test.sqlite')
    const first = new TacticalDatabase(path); await first.init()
    first.importBundle(bundle()); first.importBundle(bundle())
    expect(first.summary()).toMatchObject({ matches: 1, teams: 2, players: 1, events: 1 })
    expect(first.getMatchBundle('db-test').events[0].id).toBe('e1')
    expect(() => first.getMatchBundle('missing')).toThrow('不存在')
    const reopened = new TacticalDatabase(path); await reopened.init()
    expect(reopened.listMatches()).toHaveLength(1)
    expect(reopened.summary().matches).toBe(1)
  })

  it('序列化失败时回滚整个导入', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fts-db-')); tempPaths.push(directory)
    const database = new TacticalDatabase(join(directory, 'test.sqlite')); await database.init()
    const invalid = bundle('invalid')
    invalid.events[0].raw = invalid
    expect(() => database.importBundle(invalid)).toThrow()
    expect(database.summary().matches).toBe(0)
    database.importBundle(bundle('valid'))
    expect(database.summary().matches).toBe(1)
  })
})
