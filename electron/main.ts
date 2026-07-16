import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TacticalDatabase } from './database'
import { ImportService } from './importer'
import { createDemoScenario } from '../src/engine/demo'
import { validateScenario } from '../src/engine/simulation'
import { fetchStatsBombOpenMatch } from '../src/providers/statsbomb'
import { fetchFootballDataMatch, testFootballData } from '../src/providers/footballData'
import type { CanonicalMatchBundle, MatchEvent, SimulationComparison, TacticalScenario } from '../src/types'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
let mainWindow: BrowserWindow | null = null
let database: TacticalDatabase
const imports = new ImportService()

function demoBundles(): CanonicalMatchBundle[] {
  const scenario = createDemoScenario()
  const allPlayers = [...scenario.home, ...scenario.away]
  const event = (matchId: string, index: number, teamId: 'home' | 'away', playerId: string, kind: MatchEvent['kind'], start: [number, number], end?: [number, number], outcome?: MatchEvent['outcome'], recipientId?: string, xg?: number): MatchEvent => ({
    id: `${matchId}-event-${index}`, matchId, period: index < 11 ? 1 : 2, second: index * 41,
    teamId, playerId, recipientId, kind, start: { x: start[0], y: start[1] }, end: end ? { x: end[0], y: end[1] } : undefined, outcome, xg
  })
  const matchDefinitions = [
    { id: 'demo-team-1', date: '2026-06-20', homeTeamId: 'home', awayTeamId: 'away', homeScore: 2, awayScore: 1, homeRisk: false },
    { id: 'demo-team-2', date: '2026-06-27', homeTeamId: 'away', awayTeamId: 'home', homeScore: 0, awayScore: 1, homeRisk: true },
    { id: 'demo-team-3', date: '2026-07-05', homeTeamId: 'home', awayTeamId: 'away', homeScore: 1, awayScore: 1, homeRisk: false }
  ] as const
  return matchDefinitions.map(definition => {
    const events: MatchEvent[] = [
      event(definition.id, 1, 'home', 'home-1', 'pass', [8, 34], [24, 38], 'success', 'home-4'),
      event(definition.id, 2, 'home', 'home-4', 'pass', [24, 38], [43, 34], 'success', 'home-6'),
      event(definition.id, 3, 'home', 'home-6', 'pass', [43, 34], [65, 28], 'success', 'home-10'),
      event(definition.id, 4, 'home', 'home-10', 'pass', [65, 28], [76, 12], definition.homeRisk ? 'failure' : 'success', 'home-11'),
      event(definition.id, 5, 'home', 'home-11', 'carry', [76, 12], [89, 20], 'success'),
      event(definition.id, 6, 'home', 'home-11', 'pass', [89, 20], [94, 34], 'success', 'home-9'),
      event(definition.id, 7, 'home', 'home-9', 'shot', [94, 34], [105, 34], definition.homeRisk ? 'failure' : 'success', undefined, definition.homeRisk ? .18 : .34),
      event(definition.id, 8, 'home', 'home-7', 'pressure', [74, 51]),
      event(definition.id, 9, 'home', 'home-8', 'recovery', [72, 38], undefined, 'success'),
      event(definition.id, 10, 'home', 'home-10', 'turnover', [58, 31]),
      event(definition.id, 11, 'away', 'away-1', 'pass', [9, 34], [27, 30], 'success', 'away-4'),
      event(definition.id, 12, 'away', 'away-4', 'pass', [27, 30], [46, 39], 'success', 'away-8'),
      event(definition.id, 13, 'away', 'away-8', 'pass', [46, 39], [68, 54], 'success', 'away-7'),
      event(definition.id, 14, 'away', 'away-7', 'carry', [68, 54], [78, 49], 'success'),
      event(definition.id, 15, 'away', 'away-7', 'pass', [78, 49], [92, 35], definition.homeRisk ? 'success' : 'failure', 'away-9'),
      event(definition.id, 16, 'away', 'away-9', 'shot', [92, 35], [105, 34], 'failure', undefined, definition.homeRisk ? .29 : .14),
      event(definition.id, 17, 'away', 'away-6', 'pressure', [68, 31]),
      event(definition.id, 18, 'away', 'away-6', 'recovery', [64, 35], undefined, 'success'),
      event(definition.id, 19, 'away', 'away-8', 'turnover', [52, 40])
    ]
    return {
      schemaVersion: 1,
      source: { provider: '内置合成示例', sourceId: definition.id, importedAt: new Date().toISOString(), attribution: '完全合成数据，仅用于产品演示与测试。' },
      match: { id: definition.id, competition: '战术实验示例', season: '2026', date: definition.date, homeTeamId: definition.homeTeamId, awayTeamId: definition.awayTeamId, homeScore: definition.homeScore, awayScore: definition.awayScore },
      teams: [{ id: 'home', name: '海港竞技', color: '#19c37d' }, { id: 'away', name: '城南联队', color: '#ff7262' }],
      players: allPlayers.map(player => ({ id: player.playerId, name: player.name, teamId: player.side, shirtNumber: player.shirtNumber, position: player.position })),
      lineups: allPlayers.map(player => ({ teamId: player.side, playerId: player.playerId, starter: true, position: player.position })),
      events,
      frames: [{ second: 164, possessionTeamId: 'home', ball: { x: 65, y: 28 }, players: allPlayers.map(player => ({ playerId: player.playerId, teammate: player.side === 'home', position: player.anchor })), confidence: 'modelled-high' }]
    }
  })
}

async function readStoredToken(): Promise<string> {
  const path = join(app.getPath('userData'), 'football-data.token')
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return ''
  try { return safeStorage.decryptString(await readFile(path)) } catch { return '' }
}

async function writeStoredToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全加密 Token')
  await writeFile(join(app.getPath('userData'), 'football-data.token'), safeStorage.encryptString(token.trim()))
}

function registerIpc(): void {
  ipcMain.handle('db:summary', () => database.summary())
  ipcMain.handle('db:list-matches', () => database.listMatches())
  ipcMain.handle('db:get-match', (_event, matchId: string) => database.getMatchBundle(String(matchId).slice(0, 200)))
  ipcMain.handle('db:get-related-matches', (_event, matchId: string) => database.getRelatedMatchBundles(String(matchId).slice(0, 200)))
  ipcMain.handle('db:get-team-matches', (_event, matchId: string, teamId: string) => database.getTeamMatchBundles(String(matchId).slice(0, 200), String(teamId).slice(0, 200)))
  ipcMain.handle('db:seed-demo', () => {
    demoBundles().forEach(bundle => database.importBundle(bundle))
    return { ok: true, message: '3 场球队级合成示例已写入本地数据库。', summary: database.summary() }
  })
  ipcMain.handle('scenario:save', (_event, scenario: TacticalScenario) => { validateScenario(scenario); database.saveScenario(scenario); return { ok: true } })
  ipcMain.handle('import:preview', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择足球比赛数据', properties: ['openFile'], filters: [
      { name: '支持的数据文件', extensions: ['json', 'csv', 'zip', 'png', 'jpg', 'jpeg'] }, { name: '所有文件', extensions: ['*'] }
    ] })
    if (result.canceled || !result.filePaths[0]) return null
    return imports.preview(result.filePaths[0])
  })
  ipcMain.handle('import:commit', (_event, token: string) => {
    database.importBundle(imports.take(token))
    return { ok: true, message: '数据已通过事务校验并导入。', summary: database.summary() }
  })
  ipcMain.handle('provider:statsbomb-import', async (_event, matchId: string) => {
    const bundle = await fetchStatsBombOpenMatch(matchId)
    database.importBundle(bundle)
    return { ok: true, message: `已导入 StatsBomb 比赛 ${matchId}，包括 ${bundle.events.length} 个事件和 ${bundle.frames.length} 个空间快照。`, summary: database.summary() }
  })
  ipcMain.handle('provider:football-data-test', (_event, token: string) => testFootballData(token))
  ipcMain.handle('provider:football-data-save-token', async (_event, token: string) => {
    const result = await testFootballData(token)
    if (!result.ok) return result
    await writeStoredToken(token)
    return { ok: true, message: 'Token 已使用系统安全存储加密保存。' }
  })
  ipcMain.handle('provider:football-data-import', async (_event, matchId: string, token?: string) => {
    const resolvedToken = token?.trim() || await readStoredToken()
    const bundle = await fetchFootballDataMatch(matchId, resolvedToken)
    database.importBundle(bundle)
    return { ok: true, message: `已导入 ${bundle.teams[0].name} 对 ${bundle.teams[1].name} 的比赛资料。`, summary: database.summary() }
  })
  ipcMain.handle('db:backup', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, { title: '备份战术数据库', defaultPath: `football-tactics-backup-${new Date().toISOString().slice(0, 10)}.sqlite`, filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }] })
    if (result.canceled || !result.filePath) return { ok: false }
    database.backup(result.filePath)
    return { ok: true, path: result.filePath }
  })
  ipcMain.handle('result:export', (_event, format: 'json' | 'csv' | 'pdf', comparison: SimulationComparison) => exportComparison(format, comparison))
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), databasePath: database.path, platform: `${process.platform} ${process.arch}` }))
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!) }

async function exportComparison(format: 'json' | 'csv' | 'pdf', comparison: SimulationComparison): Promise<{ ok: boolean; path?: string }> {
  const result = await dialog.showSaveDialog(mainWindow!, { title: '导出推演结果', defaultPath: `tactical-comparison-${Date.now()}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
  if (result.canceled || !result.filePath) return { ok: false }
  if (format === 'json') await writeFile(result.filePath, JSON.stringify(comparison, null, 2), 'utf8')
  else if (format === 'csv') {
    const keys = Object.keys(comparison.deltas) as Array<keyof typeof comparison.deltas>
    const text = ['metric,baseline,modified,delta', ...keys.map(key => `${key},${comparison.baseline.metrics[key]},${comparison.modified.metrics[key]},${comparison.deltas[key]}`)].join('\n')
    await writeFile(result.filePath, text, 'utf8')
  } else {
    const rows = Object.entries(comparison.deltas).map(([key, delta]) => `<tr><td>${escapeHtml(key)}</td><td>${comparison.baseline.metrics[key as keyof typeof comparison.deltas].toFixed(3)}</td><td>${comparison.modified.metrics[key as keyof typeof comparison.deltas].toFixed(3)}</td><td>${Number(delta) >= 0 ? '+' : ''}${Number(delta).toFixed(3)}</td></tr>`).join('')
    const html = `<!doctype html><meta charset="utf-8"><style>body{font:14px Arial;color:#13231c;padding:42px}h1{color:#087552}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd8d1;padding:10px;text-align:left}.note{margin-top:28px;color:#647069}</style><h1>Football Tactical Simulation</h1><h2>战术推演对比报告</h2><p>生成时间：${new Date().toLocaleString('zh-CN')}</p><table><thead><tr><th>指标</th><th>基准</th><th>修改后</th><th>变化</th></tr></thead><tbody>${rows}</tbody></table><p class="note">本报告为概率分析，不构成对真实比赛结果的预测。核心计算未使用 AI。</p>`
    const reportWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
    await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await reportWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    reportWindow.destroy()
    await writeFile(result.filePath, pdf)
  }
  return { ok: true, path: result.filePath }
}

async function createWindow(): Promise<void> {
  const smokeTest = process.env.FTS_SMOKE_TEST === '1'
  mainWindow = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1120, minHeight: 720, backgroundColor: '#071a15',
    title: 'Football Tactical Simulation', show: false,
    webPreferences: { preload: join(__dirname, '../preload/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  mainWindow.once('ready-to-show', async () => {
    if (smokeTest) {
      const rendered = await mainWindow?.webContents.executeJavaScript("document.getElementById('root')?.textContent?.includes('数据中心')")
      app.exit(rendered ? 0 : 2)
    } else mainWindow?.show()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  await mkdir(app.getPath('userData'), { recursive: true })
  database = new TacticalDatabase(join(app.getPath('userData'), 'football-tactics.sqlite'))
  await database.init()
  registerIpc()
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
