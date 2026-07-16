export type Vec2 = { x: number; y: number }
export type TeamSide = 'home' | 'away'
export type Confidence = 'observed' | 'modelled-high' | 'modelled-low'
export type EventKind = 'pass' | 'carry' | 'shot' | 'duel' | 'pressure' | 'turnover' | 'recovery'

export interface ProviderCapabilities {
  competitions: boolean
  matches: boolean
  lineups: boolean
  events: boolean
  threeSixty: boolean
  tracking: boolean
  live: boolean
}

export interface ProviderCompetition {
  id: string
  name: string
  country?: string
  seasons?: Array<{ id: string; name: string }>
}

export interface ProviderMatch {
  id: string
  competitionId: string
  seasonId?: string
  date: string
  homeTeam: string
  awayTeam: string
  score?: string
}

export interface DataProviderAdapter {
  readonly id: string
  readonly name: string
  getCapabilities(): ProviderCapabilities
  testConnection(): Promise<{ ok: boolean; message: string }>
  listCompetitions(): Promise<ProviderCompetition[]>
  listMatches(competitionId: string, seasonId?: string): Promise<ProviderMatch[]>
  fetchMatchBundle(matchId: string): Promise<CanonicalMatchBundle>
}

export interface Player {
  id: string
  name: string
  teamId: string
  shirtNumber: number
  position: string
}

export interface Team {
  id: string
  name: string
  color: string
}

export interface MatchInfo {
  id: string
  competition: string
  season: string
  date: string
  homeTeamId: string
  awayTeamId: string
  homeScore?: number
  awayScore?: number
}

export interface MatchEvent {
  id: string
  matchId: string
  period: number
  second: number
  teamId: string
  playerId?: string
  recipientId?: string
  kind: EventKind
  start: Vec2
  end?: Vec2
  outcome?: 'success' | 'failure'
  xg?: number
  underPressure?: boolean
  raw?: unknown
}

export interface TrackingPlayer {
  playerId?: string
  teammate: boolean
  position: Vec2
  speed?: number
}

export interface TrackingFrame {
  second: number
  possessionTeamId?: string
  ball?: Vec2
  players: TrackingPlayer[]
  confidence: Confidence
}

export interface CanonicalMatchBundle {
  schemaVersion: 1
  source: { provider: string; sourceId: string; importedAt: string; attribution?: string }
  match: MatchInfo
  teams: Team[]
  players: Player[]
  lineups: Array<{ teamId: string; playerId: string; starter: boolean; position?: string }>
  events: MatchEvent[]
  frames: TrackingFrame[]
  heatmapReferences?: Array<{ playerId?: string; name: string; dataUrl?: string }>
}

export type PlayerDuty = '防守' | '支援' | '进攻'
export type RunPattern = '保持位置' | '前插' | '回撤接应' | '套边' | '内切' | '自由跑位'

export interface PlayerTacticalProfile {
  playerId: string
  name: string
  shirtNumber: number
  side: TeamSide
  position: string
  role: string
  duty: PlayerDuty
  anchor: Vec2
  runPattern: RunPattern
  passRisk: number
  passForward: number
  passDirectness: number
  shootTendency: number
  carryTendency: number
  pressIntensity: number
  marking: number
  attributes: {
    passing: number
    firstTouch: number
    dribbling: number
    shooting: number
    pace: number
    stamina: number
    decisions: number
    vision: number
  }
  goalkeeping?: {
    shotStopping: number
    handling: number
    aerialReach: number
    oneOnOnes: number
    rushingOut: number
    distribution: number
  }
  confidence: Confidence
  historicalSampleSize?: number
}

export interface TeamTactics {
  width: number
  depth: number
  defensiveLine: number
  pressing: number
  transitionSpeed: number
  buildUp: '短传组织' | '混合推进' | '快速直接'
  focus: '左路' | '中路' | '右路' | '均衡'
}

export interface TacticalScenario {
  id: string
  name: string
  sourceMatchId?: string
  startingBall: Vec2
  possession: TeamSide
  home: PlayerTacticalProfile[]
  away: PlayerTacticalProfile[]
  homeTactics: TeamTactics
  awayTactics: TeamTactics
  seed: number
  iterations: number
  maxActions: number
  calibration?: {
    provider: string
    sourceMatchId: string
    matchCount: number
    eventCount: number
    frameCount: number
    lowSamplePlayers: number
  }
}

export interface SimulationAction {
  index: number
  kind: EventKind
  playerId: string
  targetPlayerId?: string
  start: Vec2
  end: Vec2
  success: boolean
  probability: number
  xg?: number
  note: string
}

export interface SimulationMetrics {
  possessions: number
  shotRate: number
  averageXg: number
  boxEntries: number
  retentionRate: number
  averageProgression: number
  leftShare: number
  centreShare: number
  rightShare: number
}

export interface SimulationResult {
  scenarioId: string
  seed: number
  createdAt: string
  metrics: SimulationMetrics
  confidenceInterval: { shotRate: [number, number]; retentionRate: [number, number] }
  representativeSuccess: SimulationAction[]
  representativeFailure: SimulationAction[]
  playerHeatmaps: Record<string, Vec2[]>
  passNetwork: Array<{ from: string; to: string; count: number; successRate: number }>
  qualityNotes: string[]
}

export interface SimulationComparison {
  baseline: SimulationResult
  modified: SimulationResult
  deltas: Pick<SimulationMetrics, 'shotRate' | 'averageXg' | 'boxEntries' | 'retentionRate' | 'averageProgression'>
}

export interface ImportPreview {
  fileName: string
  format: 'statsbomb-json' | 'canonical-json' | 'tracking-csv' | 'zip' | 'heatmap-image'
  valid: boolean
  matchCount: number
  playerCount: number
  eventCount: number
  frameCount: number
  warnings: string[]
  errors: string[]
  token: string
}

export interface DatabaseSummary {
  matches: number
  teams: number
  players: number
  events: number
  frames: number
  scenarios: number
  lastImportedAt?: string
}

export interface StoredMatchSummary {
  id: string
  competition: string
  season: string
  date: string
  homeTeam: string
  awayTeam: string
  eventCount: number
  frameCount: number
  source: string
}

export interface TeamAnalysisMetrics {
  eventShare: number
  passSuccess: number
  forwardPassShare: number
  progressiveActionsPerMatch: number
  finalThirdEntriesPerMatch: number
  boxEntriesPerMatch: number
  shotsPerMatch: number
  xgPerMatch: number | null
  xgPerShot: number | null
  turnoversPerMatch: number
  defensiveActionsPerMatch: number
  highRegainsPerMatch: number
  fieldTilt: number
  ppdaApprox: number | null
  buildUpShare: number
  middleThirdShare: number
  finalThirdShare: number
  leftShare: number
  centreShare: number
  rightShare: number
}

export interface TeamMatchTrend {
  matchId: string
  date: string
  opponentId: string
  opponentName: string
  venue: '主场' | '客场'
  score?: string
  result?: '胜' | '平' | '负'
  metrics: TeamAnalysisMetrics
}

export interface TeamPlayerContribution {
  playerId: string
  name: string
  position: string
  shirtNumber: number
  matches: number
  events: number
  passes: number
  passSuccess: number
  progressiveActions: number
  carries: number
  shots: number
  xg: number | null
  defensiveActions: number
  turnovers: number
  involvementShare: number
  influenceIndex: number
}

export interface TeamZoneAnalysis {
  id: string
  label: string
  column: number
  row: number
  actionShare: number
  opponentShare: number
  delta: number
}

export interface TeamAnalysisInsight {
  kind: 'strength' | 'watch' | 'risk'
  title: string
  evidence: string
  action: string
}

export interface TeamTacticalAnalysis {
  teamId: string
  teamName: string
  teamColor: string
  provider: string
  competitions: string[]
  seasons: string[]
  dateRange: { from: string; to: string }
  matchesAnalyzed: number
  record: { wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; scoredMatches: number }
  metrics: TeamAnalysisMetrics
  opponentMetrics: TeamAnalysisMetrics
  trends: TeamMatchTrend[]
  formationUsage: Array<{ formation: string; count: number; share: number }>
  zones: TeamZoneAnalysis[]
  players: TeamPlayerContribution[]
  passNetwork: Array<{ fromId: string; fromName: string; toId: string; toName: string; count: number; successRate: number }>
  insights: TeamAnalysisInsight[]
  dataQuality: {
    scoreCoverage: number
    xgCoverage: number
    playerAttribution: number
    trackingCoverage: number
    level: '高' | '中' | '低'
    notes: string[]
  }
  generatedAt: string
}

export interface AiAnalysisProvider {
  readonly enabled: false
  readonly name: string
  analyse(_scenario: TacticalScenario, _result: SimulationResult): Promise<never>
}

export interface DesktopApi {
  getDatabaseSummary(): Promise<DatabaseSummary>
  listMatches(): Promise<StoredMatchSummary[]>
  getMatchBundle(matchId: string): Promise<CanonicalMatchBundle>
  getRelatedMatchBundles(matchId: string): Promise<CanonicalMatchBundle[]>
  getTeamMatchBundles(matchId: string, teamId: string): Promise<CanonicalMatchBundle[]>
  previewImport(): Promise<ImportPreview | null>
  commitImport(token: string): Promise<{ ok: boolean; message: string; summary: DatabaseSummary }>
  seedDemo(): Promise<{ ok: boolean; message: string; summary: DatabaseSummary }>
  importStatsBombOpen(matchId: string): Promise<{ ok: boolean; message: string; summary: DatabaseSummary }>
  importFootballDataMatch(matchId: string, token?: string): Promise<{ ok: boolean; message: string; summary: DatabaseSummary }>
  testFootballData(token: string): Promise<{ ok: boolean; message: string }>
  saveFootballDataToken(token: string): Promise<{ ok: boolean; message: string }>
  saveScenario(scenario: TacticalScenario): Promise<{ ok: boolean }>
  exportResult(format: 'json' | 'csv' | 'pdf', comparison: SimulationComparison): Promise<{ ok: boolean; path?: string }>
  backupDatabase(): Promise<{ ok: boolean; path?: string }>
  getAppInfo(): Promise<{ version: string; databasePath: string; platform: string }>
}

declare global {
  interface Window { footballApi: DesktopApi }
}
