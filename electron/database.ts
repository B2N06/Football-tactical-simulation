import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Database, SqlJsStatic } from 'sql.js'
import initSqlJs from 'sql.js'
import type { CanonicalMatchBundle, DatabaseSummary, StoredMatchSummary, TacticalScenario } from '../src/types'

const require = createRequire(import.meta.url)

export class TacticalDatabase {
  private database?: Database
  constructor(readonly path: string) {}

  async init(): Promise<void> {
    const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
    this.database = existsSync(this.path) ? new SQL.Database(readFileSync(this.path)) : new SQL.Database()
    this.database.run(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY, competition TEXT NOT NULL, season TEXT NOT NULL, match_date TEXT NOT NULL,
        home_team TEXT NOT NULL, away_team TEXT NOT NULL, event_count INTEGER NOT NULL,
        frame_count INTEGER NOT NULL, source TEXT NOT NULL, imported_at TEXT NOT NULL, bundle_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scenarios (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT NOT NULL, scenario_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);
      CREATE INDEX IF NOT EXISTS idx_matches_source ON matches(source);
    `)
    this.persist()
  }

  private get db(): Database {
    if (!this.database) throw new Error('数据库尚未初始化')
    return this.database
  }

  private persist(): void { writeFileSync(this.path, Buffer.from(this.db.export())) }

  importBundle(bundle: CanonicalMatchBundle): void {
    const home = bundle.teams.find(team => team.id === bundle.match.homeTeamId)?.name ?? '主队'
    const away = bundle.teams.find(team => team.id === bundle.match.awayTeamId)?.name ?? '客队'
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run(`INSERT OR REPLACE INTO matches
        (id, competition, season, match_date, home_team, away_team, event_count, frame_count, source, imported_at, bundle_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [bundle.match.id, bundle.match.competition, bundle.match.season, bundle.match.date,
        home, away, bundle.events.length, bundle.frames.length, bundle.source.provider, bundle.source.importedAt, JSON.stringify(bundle)])
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  saveScenario(scenario: TacticalScenario): void {
    this.db.run('INSERT OR REPLACE INTO scenarios (id, name, updated_at, scenario_json) VALUES (?, ?, ?, ?)', [scenario.id, scenario.name, new Date().toISOString(), JSON.stringify(scenario)])
    this.persist()
  }

  summary(): DatabaseSummary {
    const rows = this.db.exec('SELECT event_count, frame_count, imported_at, bundle_json FROM matches')[0]?.values ?? []
    const teamIds = new Set<string>(), playerIds = new Set<string>()
    let events = 0, frames = 0
    for (const row of rows) {
      const bundle = JSON.parse(String(row[3])) as CanonicalMatchBundle
      bundle.teams.forEach(team => teamIds.add(`${bundle.source.provider}:${team.id}`))
      bundle.players.forEach(player => playerIds.add(`${bundle.source.provider}:${player.id}`))
      events += Number(row[0]); frames += Number(row[1])
    }
    const scenarioRow = this.db.exec('SELECT COUNT(*) FROM scenarios')[0]?.values[0]
    const dates = rows.map(row => String(row[2])).filter(Boolean).sort()
    return { matches: rows.length, teams: teamIds.size, players: playerIds.size, events, frames, scenarios: Number(scenarioRow?.[0] ?? 0), lastImportedAt: dates.at(-1) }
  }

  listMatches(): StoredMatchSummary[] {
    const result = this.db.exec('SELECT id, competition, season, match_date, home_team, away_team, event_count, frame_count, source FROM matches ORDER BY imported_at DESC')
    return (result[0]?.values ?? []).map(row => ({ id: String(row[0]), competition: String(row[1]), season: String(row[2]), date: String(row[3]), homeTeam: String(row[4]), awayTeam: String(row[5]), eventCount: Number(row[6]), frameCount: Number(row[7]), source: String(row[8]) }))
  }

  getMatchBundle(matchId: string): CanonicalMatchBundle {
    const statement = this.db.prepare('SELECT bundle_json FROM matches WHERE id = ?')
    try {
      statement.bind([matchId])
      if (!statement.step()) throw new Error('比赛不存在或已被删除')
      return JSON.parse(String(statement.get()[0])) as CanonicalMatchBundle
    } finally { statement.free() }
  }

  getRelatedMatchBundles(matchId: string, limit = 20): CanonicalMatchBundle[] {
    const primary = this.getMatchBundle(matchId)
    const playerIds = new Set(primary.players.map(player => player.id))
    const result = this.db.exec('SELECT bundle_json FROM matches ORDER BY imported_at DESC')
    const related = (result[0]?.values ?? []).map(row => JSON.parse(String(row[0])) as CanonicalMatchBundle)
      .filter(bundle => bundle.match.id !== primary.match.id && bundle.source.provider === primary.source.provider && bundle.players.some(player => playerIds.has(player.id)))
      .slice(0, Math.max(0, Math.min(49, limit - 1)))
    return [primary, ...related]
  }

  getTeamMatchBundles(matchId: string, teamId: string, limit = 30): CanonicalMatchBundle[] {
    const primary = this.getMatchBundle(matchId)
    const participated = (bundle: CanonicalMatchBundle) => bundle.match.homeTeamId === teamId || bundle.match.awayTeamId === teamId
    if (!participated(primary)) throw new Error('所选球队未参加基准比赛')
    const result = this.db.exec('SELECT bundle_json FROM matches ORDER BY match_date DESC, imported_at DESC')
    const candidates = (result[0]?.values ?? []).map(row => JSON.parse(String(row[0])) as CanonicalMatchBundle)
      .filter(bundle => bundle.source.provider === primary.source.provider && participated(bundle))
    const ordered = [primary, ...candidates.filter(bundle => bundle.match.id !== primary.match.id)]
    return ordered.slice(0, Math.max(1, Math.min(50, limit)))
  }

  backup(destination: string): void { writeFileSync(destination, Buffer.from(this.db.export())) }
}
