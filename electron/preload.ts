import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../src/types'

const api: DesktopApi = {
  getDatabaseSummary: () => ipcRenderer.invoke('db:summary'),
  listMatches: () => ipcRenderer.invoke('db:list-matches'),
  getMatchBundle: matchId => ipcRenderer.invoke('db:get-match', matchId),
  getRelatedMatchBundles: matchId => ipcRenderer.invoke('db:get-related-matches', matchId),
  getTeamMatchBundles: (matchId, teamId) => ipcRenderer.invoke('db:get-team-matches', matchId, teamId),
  previewImport: () => ipcRenderer.invoke('import:preview'),
  commitImport: token => ipcRenderer.invoke('import:commit', token),
  seedDemo: () => ipcRenderer.invoke('db:seed-demo'),
  importStatsBombOpen: matchId => ipcRenderer.invoke('provider:statsbomb-import', matchId),
  importFootballDataMatch: (matchId, token) => ipcRenderer.invoke('provider:football-data-import', matchId, token),
  testFootballData: token => ipcRenderer.invoke('provider:football-data-test', token),
  saveFootballDataToken: token => ipcRenderer.invoke('provider:football-data-save-token', token),
  saveScenario: scenario => ipcRenderer.invoke('scenario:save', scenario),
  exportResult: (format, comparison) => ipcRenderer.invoke('result:export', format, comparison),
  backupDatabase: () => ipcRenderer.invoke('db:backup'),
  getAppInfo: () => ipcRenderer.invoke('app:info')
}

contextBridge.exposeInMainWorld('footballApi', api)
