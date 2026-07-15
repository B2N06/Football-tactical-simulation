import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TacticalDatabase } from './database'
import { ImportService } from './importer'
import { createDemoScenario } from '../src/engine/demo'
import { fetchStatsBombOpenMatch } from '../src/providers/statsbomb'
import { fetchFootballDataMatch, testFootballData } from '../src/providers/footballData'
import type { CanonicalMatchBundle, SimulationComparison, TacticalScenario } from '../src/types'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
let mainWindow: BrowserWindow | null = null
let database: TacticalDatabase
const imports = new ImportService()

function demoBundle(): CanonicalMatchBundle {
  const scenario = createDemoScenario()
  const allPlayers = [...scenario.home, ...scenario.away]
  return {
    schemaVersion: 1, source: { provider: '内置合成示例', sourceId: 'demo', importedAt: new Date().toISOString() },
    match: { id: 'demo-match', competition: '战术实验示例', season: '2026', date: '2026-07-15', homeTeamId: 'home', awayTeamId: 'away' },
    teams: [{ id: 'home', name: '海港竞技', color: '#19c37d' }, { id: 'away', name: '城南联队', color: '#ff7262' }],
    players: allPlayers.map(player => ({ id: player.playerId, name: player.name, teamId: player.side, shirtNumber: player.shirtNumber, position: player.position })),
    lineups: allPlayers.map(player => ({ teamId: player.side, playerId: player.playerId, starter: true, position: player.position })),
    events: [], frames: []
  }
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
  ipcMain.handle('db:seed-demo', () => {
    database.importBundle(demoBundle())
    return { ok: true, message: '合成示例已写入本地数据库。', summary: database.summary() }
  })
  ipcMain.handle('scenario:save', (_event, scenario: TacticalScenario) => { database.saveScenario(scenario); return { ok: true } })
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
    webPreferences: { preload: join(__dirname, '../preload/preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  mainWindow.once('ready-to-show', () => {
    if (smokeTest) setTimeout(() => app.quit(), 500)
    else mainWindow?.show()
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
