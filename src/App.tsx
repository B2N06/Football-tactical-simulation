import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Pitch } from './components/Pitch'
import { MetricCard } from './components/MetricCard'
import { MatchAnalysisPage } from './components/MatchAnalysisPage'
import { createDemoScenario } from './engine/demo'
import { createScenarioFromBundles } from './engine/history'
import { getPlayerSide } from './engine/scenario'
import { getGoalkeepingAttributes, getPlayerInstructionPreset } from './engine/playerInstructions'
import { buildComparisonVerdict, presentComparisonMetrics } from './engine/resultPresentation'
import { describePlayerChanges, summarizeScenarioChanges, type ScenarioChangeSummary } from './engine/scenarioDiff'
import type { DatabaseSummary, ImportPreview, PlayerTacticalProfile, SimulationAction, SimulationComparison, StoredMatchSummary, TacticalScenario, TeamSide, Vec2 } from './types'

type Page = 'data' | 'analysis' | 'team' | 'players' | 'tactics' | 'simulation' | 'settings'

const nav: Array<{ id: Page; label: string }> = [
  { id: 'data', label: '数据中心' }, { id: 'analysis', label: '比赛分析' }, { id: 'team', label: '球队分析' },
  { id: 'players', label: '球员档案' }, { id: 'tactics', label: '战术编辑器' },
  { id: 'simulation', label: '推演实验室' }, { id: 'settings', label: '设置' }
]

const emptySummary: DatabaseSummary = { matches: 0, teams: 0, players: 0, events: 0, frames: 0, scenarios: 0 }
const clone = <T,>(value: T): T => structuredClone(value)
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const signed = (value: number, scale = 100) => `${value >= 0 ? '+' : ''}${(value * scale).toFixed(1)}${scale === 100 ? '%' : ''}`
const attributeLabels: Record<keyof PlayerTacticalProfile['attributes'], string> = { passing:'传球', firstTouch:'停球', dribbling:'盘带', shooting:'射门', pace:'速度', stamina:'耐力', decisions:'决策', vision:'视野' }
const actionLabels: Record<SimulationAction['kind'], string> = { pass: '传球', carry: '带球', shot: '射门', duel: '对抗', pressure: '压迫', turnover: '丢失球权', recovery: '夺回球权' }
const TeamAnalysisPage = lazy(() => import('./components/TeamAnalysisPage').then(module => ({ default: module.TeamAnalysisPage })))

function Slider({ label, value, onChange, hint, onEditStart, onEditEnd }: { label: string; value: number; onChange: (value: number) => void; hint?: string; onEditStart?: () => void; onEditEnd?: () => void }) {
  return <label className="slider-field"><span>{label}<b>{value}</b></span><input type="range" min="0" max="100" value={value} onPointerDown={onEditStart} onPointerUp={onEditEnd} onPointerCancel={onEditEnd} onKeyDown={onEditStart} onKeyUp={onEditEnd} onChange={event => onChange(Number(event.target.value))}/>{hint && <small>{hint}</small>}</label>
}

function App() {
  const [page, setPage] = useState<Page>('data')
  const [summary, setSummary] = useState<DatabaseSummary>(emptySummary)
  const [matches, setMatches] = useState<StoredMatchSummary[]>([])
  const [baseline, setBaseline] = useState<TacticalScenario>(() => createDemoScenario())
  const [scenario, setScenarioState] = useState<TacticalScenario>(() => clone(createDemoScenario()))
  const scenarioLoadRef = useRef(0)
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const scenarioRef = useRef(scenario)
  const setScenario: React.Dispatch<React.SetStateAction<TacticalScenario>> = value => {
    const next = typeof value === 'function' ? value(scenarioRef.current) : value
    // An edit made while a historical scenario is loading takes precedence over that pending response.
    scenarioLoadRef.current++
    setScenarioLoading(false)
    scenarioRef.current = next
    setScenarioState(next)
  }
  const [selectedId, setSelectedId] = useState('home-10')
  const [side, setSide] = useState<TeamSide>('home')
  const [comparison, setComparison] = useState<SimulationComparison | null>(null)
  const [comparisonScenario, setComparisonScenario] = useState<TacticalScenario | null>(null)
  const [running, setRunning] = useState(false)
  const [simulationProgress, setSimulationProgress] = useState({ value: 0, phase: '准备计算' })
  const [replayStep, setReplayStep] = useState(0)
  const [replayMode, setReplayMode] = useState<'success' | 'failure'>('success')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [statsBombId, setStatsBombId] = useState('')
  const [footballDataToken, setFootballDataToken] = useState('')
  const [footballDataMatchId, setFootballDataMatchId] = useState('')
  const [appInfo, setAppInfo] = useState({ version: '0.7.0', databasePath: '正在读取…', platform: 'Windows x64' })
  const workerRef = useRef<Worker | null>(null)
  const actionPendingRef = useRef(false)
  const undoStackRef = useRef<TacticalScenario[]>([])
  const redoStackRef = useRef<TacticalScenario[]>([])
  const editStartRef = useRef<TacticalScenario | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const lastPageRef = useRef(page)
  const pageRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (lastPageRef.current === page) return
    lastPageRef.current = page
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const element = pageRef.current
    if (!element?.animate || element.matches(':focus-within')) return
    const animation = element.animate([{ opacity: .4, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' })
    return () => animation.cancel()
  }, [page])

  const refreshData = async () => {
    if (!window.footballApi) throw new Error('桌面安全桥接不可用，请重新启动或重新安装应用。')
    const [nextSummary, nextMatches] = await Promise.all([window.footballApi.getDatabaseSummary(), window.footballApi.listMatches()])
    setSummary(nextSummary); setMatches(nextMatches)
  }
  useEffect(() => {
    if (!window.footballApi) {
      setNotice({ kind: 'error', text: '桌面安全桥接加载失败，数据操作已停用。请重新启动或重新安装应用。' })
      return
    }
    void refreshData().catch(error => setNotice({ kind: 'error', text: String(error) }))
    void window.footballApi.getAppInfo().then(setAppInfo).catch(error => setNotice({ kind: 'error', text: String(error) }))
  }, [])
  useEffect(() => () => workerRef.current?.terminate(), [])

  const selected = useMemo(() => [...scenario.home, ...scenario.away].find(player => player.playerId === selectedId) ?? scenario.home[0], [scenario, selectedId])
  const scenarioChanges = useMemo(() => summarizeScenarioChanges(baseline, scenario), [baseline, scenario])
  const comparisonChanges = useMemo(() => comparisonScenario ? summarizeScenarioChanges(baseline, comparisonScenario) : scenarioChanges, [baseline, comparisonScenario, scenarioChanges])
  const comparisonIsStale = Boolean(comparison && comparisonScenario && JSON.stringify(comparisonScenario) !== JSON.stringify(scenario))
  const replayActions = comparison ? (replayMode === 'success' ? comparison.modified.representativeSuccess : comparison.modified.representativeFailure) : []

  const pushHistory = (previous: TacticalScenario) => {
    undoStackRef.current = [...undoStackRef.current.slice(-39), clone(previous)]
    redoStackRef.current = []
    setHistoryVersion(value => value + 1)
  }
  const changeScenario = (updater: (current: TacticalScenario) => TacticalScenario, checkpoint = true) => {
    const current = scenarioRef.current
    const next = updater(current)
    if (next === current) return
    if (checkpoint) pushHistory(current)
    setScenario(next)
  }
  const beginContinuousEdit = () => {
    if (!editStartRef.current) editStartRef.current = clone(scenarioRef.current)
  }
  const endContinuousEdit = () => {
    const current = scenarioRef.current
    if (editStartRef.current && JSON.stringify(editStartRef.current) !== JSON.stringify(current)) pushHistory(editStartRef.current)
    editStartRef.current = null
  }
  const updatePlayer = (changes: Partial<PlayerTacticalProfile>) => changeScenario(current => ({ ...current,
    home: current.home.map(player => player.playerId === selectedId ? { ...player, ...changes } : player),
    away: current.away.map(player => player.playerId === selectedId ? { ...player, ...changes } : player)
  }), !editStartRef.current)
  const selectPlayer = (id: string) => { setSelectedId(id); setSide(getPlayerSide(scenario, id)) }
  const selectTeam = (nextSide: TeamSide) => { setSide(nextSide); setSelectedId(scenario[nextSide][0].playerId) }
  const movePlayer = (id: string, anchor: Vec2) => {
    const targetSide = getPlayerSide(scenario, id)
    setSelectedId(id); setSide(targetSide)
    changeScenario(current => ({ ...current, [targetSide]: current[targetSide].map(player => player.playerId === id ? { ...player, anchor } : player) }), !editStartRef.current)
  }
  const updateTeamTactics = (key: 'homeTactics' | 'awayTactics', field: string, value: number | string) => changeScenario(current => ({ ...current, [key]: { ...current[key], [field]: value } }), !editStartRef.current)
  const renameScenario = (name: string) => changeScenario(current => ({ ...current, name }), !editStartRef.current)
  const undoScenario = () => {
    const previous = undoStackRef.current.pop()
    if (!previous) return
    redoStackRef.current.push(clone(scenario)); editStartRef.current = null; setScenario(clone(previous)); setHistoryVersion(value => value + 1)
  }
  const redoScenario = () => {
    const next = redoStackRef.current.pop()
    if (!next) return
    undoStackRef.current.push(clone(scenario)); editStartRef.current = null; setScenario(clone(next)); setHistoryVersion(value => value + 1)
  }
  const saveCurrentScenario = async () => {
    try {
      await window.footballApi.saveScenario(scenario)
      await refreshData()
      setNotice({ kind: 'ok', text: `方案“${scenario.name}”已保存到本地数据库。` })
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
  }

  const act = async (operation: () => Promise<{ ok?: boolean; message?: string; summary?: DatabaseSummary }>) => {
    if (actionPendingRef.current) return
    actionPendingRef.current = true
    setNotice({ kind: 'info', text: '正在处理数据，请稍候…' })
    try { const result = await operation(); if (result.ok === false) throw new Error(result.message ?? '操作未完成，请重试。'); if (result.summary) setSummary(result.summary); await refreshData(); setNotice({ kind: 'ok', text: result.message ?? '操作完成。' }) }
    catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
    finally { actionPendingRef.current = false }
  }

  const createScenarioFromMatch = async (matchId: string) => {
    const request = ++scenarioLoadRef.current
    setScenarioLoading(true)
    setNotice(null)
    try {
      const bundles = await window.footballApi.getRelatedMatchBundles(matchId)
      if (request !== scenarioLoadRef.current) return
      const next = createScenarioFromBundles(bundles)
      workerRef.current?.terminate(); workerRef.current = null; setRunning(false)
      undoStackRef.current = []; redoStackRef.current = []; editStartRef.current = null; setHistoryVersion(value => value + 1)
      setBaseline(clone(next)); setScenario(clone(next)); setSelectedId(next.home[0].playerId); setSide('home'); setComparison(null); setComparisonScenario(null); setPage('tactics')
      setNotice({ kind: 'ok', text: `已汇总 ${next.calibration?.matchCount ?? 1} 场相关比赛：${next.calibration?.eventCount ?? 0} 个事件、${next.calibration?.frameCount ?? 0} 个空间帧参与校准。` })
    } catch (error) {
      if (request === scenarioLoadRef.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (request === scenarioLoadRef.current) setScenarioLoading(false)
    }
  }

  const cancelScenarioLoad = () => {
    scenarioLoadRef.current++
    setScenarioLoading(false)
    setNotice({ kind: 'info', text: '已取消方案加载，当前战术和结果保持不变。' })
  }

  const resetScenario = () => {
    const next = clone(baseline)
    pushHistory(scenario); setScenario(next); setSelectedId(next.home[0].playerId); setSide('home'); setComparison(null); setComparisonScenario(null)
  }

  const runSimulation = () => {
    if (workerRef.current) return
    scenarioLoadRef.current++
    setScenarioLoading(false)
    setNotice(null); setRunning(true); setSimulationProgress({ value: 0, phase: '正在计算基准方案' })
    try {
      const worker = new Worker(new URL('./engine/simulation.worker.ts', import.meta.url), { type: 'module' })
      const baselineForRun = { ...baseline, iterations: scenario.iterations, seed: scenario.seed, maxActions: scenario.maxActions }
      workerRef.current = worker
      worker.onmessage = event => {
        if (event.data.type === 'progress') {
          setSimulationProgress({ value: event.data.progress, phase: event.data.phase === 'baseline' ? '正在计算基准方案' : '正在计算修改方案' })
          return
        }
        setRunning(false); workerRef.current = null; worker.terminate()
        if (event.data.ok) { setComparison(event.data.result); setComparisonScenario(clone(scenario)); setReplayStep(0); void window.footballApi.saveScenario(scenario).catch(() => setNotice({ kind: 'info', text: '推演已完成，但方案保存失败；结果仍可导出。' })); setNotice({ kind: 'ok', text: `已完成 ${scenario.iterations.toLocaleString()} × 2 次独立进攻回合推演。` }) }
        else setNotice({ kind: 'error', text: event.data.error })
      }
      worker.onerror = event => { setRunning(false); workerRef.current = null; worker.terminate(); setNotice({ kind: 'error', text: event.message || '后台推演失败' }) }
      worker.postMessage({ baseline: baselineForRun, modified: scenario })
    } catch (error) {
      workerRef.current?.terminate(); setRunning(false); workerRef.current = null
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '无法启动后台推演' })
    }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><a href="https://mossnyx.xyz/" aria-label="返回 Mossnyx 主站"><img src="./brand/lockup.svg" alt="mossnyx" width="168" height="39"/></a><div><strong>Football.</strong><small>TACTICAL WORKSPACE</small></div></div>
      <div className="workspace-label">工作空间</div>
      <nav aria-label="主导航">{nav.map((item, index) => <button key={item.id} className={page === item.id ? 'is-active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><small aria-hidden="true">{String(index + 1).padStart(2, '0')}</small><span>{item.label}</span>{item.id === 'simulation' && comparison && <em aria-label="有新的推演结果"/>}</button>)}</nav>
      <div className="sidebar__source"><span className="pulse-dot"/><div><strong>离线核心已就绪</strong><small>AI 未启用 · 本地计算</small></div></div>
      <div className="sidebar__foot">v{appInfo.version}<span>概率分析引擎</span></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><p>MOSSNYX / FOOTBALL LAB</p><h1>{nav.find(item => item.id === page)?.label}</h1></div><div className="topbar__actions"><span className="confidence-pill"><i/>概率分析 · 本地计算</span><button className="text-button" onClick={() => setPage('settings')}>设置</button></div></header>
      {notice && <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}><span>{notice.kind === 'ok' ? '✓' : notice.kind === 'info' ? 'i' : '!'}</span>{notice.text}<button aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}
      {scenarioLoading && <div className="notice notice--info" role="status"><span className="spinner"/>正在读取比赛并生成校准方案…<button onClick={cancelScenarioLoad}>取消方案加载</button></div>}
      <WorkflowGuide page={page} setPage={setPage} hasData={summary.matches > 0} changes={scenarioChanges} hasResult={Boolean(comparison)}/>
      <section ref={pageRef} className={`page-content ${page === 'tactics' ? 'page-content--editor' : ''}`}>
        {page === 'data' && <DataCenter summary={summary} matches={matches} preview={preview} setPreview={setPreview} statsBombId={statsBombId} setStatsBombId={setStatsBombId} footballDataToken={footballDataToken} setFootballDataToken={setFootballDataToken} footballDataMatchId={footballDataMatchId} setFootballDataMatchId={setFootballDataMatchId} act={act} onCreateScenario={createScenarioFromMatch}/>}
        {page === 'analysis' && <MatchAnalysisPage matches={matches}/>}
        {page === 'team' && <Suspense fallback={<div className="page-loading"><span className="spinner"/><div><b>正在打开球队分析</b><small>载入分析模块与本地比赛索引</small></div></div>}><TeamAnalysisPage matches={matches} onCreateScenario={createScenarioFromMatch}/></Suspense>}
        {page === 'players' && <PlayerProfiles scenario={scenario} selectedId={selectedId} setSelectedId={selectPlayer} setPage={setPage}/>}
        {page === 'tactics' && <TacticsEditor scenario={scenario} baseline={baseline} changeSummary={scenarioChanges} selected={selected} selectedId={selectedId} side={side} onTeamChange={selectTeam} onSelectPlayer={selectPlayer}
          updatePlayer={updatePlayer} movePlayer={movePlayer} updateTeamTactics={updateTeamTactics} onRename={renameScenario} setPage={setPage} onReset={resetScenario}
          onUndo={undoScenario} onRedo={redoScenario} canUndo={undoStackRef.current.length > 0} canRedo={redoStackRef.current.length > 0} historyVersion={historyVersion}
          onSave={() => void saveCurrentScenario()} onContinuousEditStart={beginContinuousEdit} onContinuousEditEnd={endContinuousEdit}/>}
        {page === 'simulation' && <SimulationLab
          scenario={scenario}
          changeSummary={scenarioChanges}
          setPage={setPage}
          setScenario={setScenario}
          comparison={comparison}
          comparisonScenario={comparisonScenario}
          comparisonChanges={comparisonChanges}
          comparisonIsStale={comparisonIsStale}
          running={running}
          isBrowser={appInfo.platform === 'Browser'}
          progress={simulationProgress}
          runSimulation={runSimulation}
          cancel={() => {
            workerRef.current?.terminate()
            workerRef.current = null
            setRunning(false)
            setSimulationProgress({ value: 0, phase: '已取消' })
            setNotice({ kind: 'info', text: '推演已取消，上一轮结果仍然保留。' })
          }}
          replayActions={replayActions}
          replayMode={replayMode}
          setReplayMode={setReplayMode}
          replayStep={replayStep}
          setReplayStep={setReplayStep}
          exportResult={(format) => comparison && act(() => window.footballApi.exportResult(format, comparison).then(result => ({ message: result.ok ? `已导出到 ${result.path}` : '已取消导出。' })))}
        />}
        {page === 'settings' && <Settings appInfo={appInfo} summary={summary} onBackup={() => act(() => window.footballApi.backupDatabase().then(result => ({ message: result.ok ? `备份已保存到 ${result.path}` : '已取消备份。' })))}/>}
      </section>
    </main>
  </div>
}

function WorkflowGuide({ page, setPage, hasData, changes, hasResult }: { page: Page; setPage: (page: Page) => void; hasData: boolean; changes: ScenarioChangeSummary; hasResult: boolean }) {
  if (!['data', 'tactics', 'simulation'].includes(page)) return null
  const steps: Array<{ page: Page; number: number; label: string; detail: string; complete: boolean }> = [
    { page: 'data', number: 1, label: '准备数据', detail: hasData ? '比赛数据可用' : '导入或载入示例', complete: hasData },
    { page: 'tactics', number: 2, label: '调整战术', detail: changes.total ? `${changes.playerCount} 名球员 · ${changes.teamSettingCount} 项整体设置` : '等待修改方案', complete: changes.total > 0 },
    { page: 'simulation', number: 3, label: '解读结果', detail: hasResult ? '已有对比结果' : '运行概率推演', complete: hasResult }
  ]
  return <nav className="workflow-guide" aria-label="推荐工作流程">
    <span className="workflow-guide__label">推荐流程</span>
    {steps.map(step => <button key={step.page} className={`${page === step.page ? 'is-active' : ''} ${step.complete ? 'is-complete' : ''}`} aria-current={page === step.page ? 'step' : undefined} onClick={() => setPage(step.page)}>
      <i>{step.complete ? '✓' : step.number}</i><span><b>{step.label}</b><small>{step.detail}</small></span>
    </button>)}
  </nav>
}

function DataCenter(props: { summary: DatabaseSummary; matches: StoredMatchSummary[]; preview: ImportPreview | null; setPreview: (value: ImportPreview | null) => void; statsBombId: string; setStatsBombId: (value: string) => void; footballDataToken: string; setFootballDataToken: (value: string) => void; footballDataMatchId: string; setFootballDataMatchId: (value: string) => void; act: (operation: () => Promise<{ message?: string; summary?: DatabaseSummary }>) => Promise<void>; onCreateScenario: (matchId: string) => Promise<void> }) {
  const { summary, matches, preview, setPreview, act } = props
  const importRequestRef = useRef(0)
  const importPendingRef = useRef(false)
  const [importPending, setImportPending] = useState(false)
  useEffect(() => () => { importRequestRef.current++ }, [])
  const chooseFile = async () => {
    if (importPendingRef.current) return
    const request = ++importRequestRef.current
    importPendingRef.current = true
    setImportPending(true)
    try {
      const next = await window.footballApi.previewImport()
      if (request === importRequestRef.current) setPreview(next)
    } catch (error) {
      if (request === importRequestRef.current) await act(() => Promise.reject(error))
    } finally {
      if (request === importRequestRef.current) { importPendingRef.current = false; setImportPending(false) }
    }
  }
  return <div className="content-stack">
    <div className="hero-grid"><section className="hero-panel"><div className="eyebrow">LOCAL DATA VAULT</div><h2>把比赛变成<br/><span>可推演的战术资产</span></h2><p>事件、360 空间快照、逐帧坐标和球员档案统一归一到 105 × 68 米球场。所有核心分析均在本地完成。</p><div className="hero-panel__actions"><button className="primary" disabled={importPending} onClick={chooseFile}>{importPending ? '正在选择 / 校验数据…' : '＋ 导入本地数据'}</button><button className="secondary" onClick={() => void act(() => window.footballApi.seedDemo())}>载入合成示例</button></div></section><div className="summary-grid"><MetricCard label="比赛" value={summary.matches.toLocaleString()} hint="本地数据库"/><MetricCard label="比赛事件" value={summary.events.toLocaleString()} hint="传球、射门、推进等"/><MetricCard label="空间快照" value={summary.frames.toLocaleString()} hint="观测或推断坐标，见比赛分析"/><MetricCard label="球员档案" value={summary.players.toLocaleString()} hint={`${summary.scenarios} 个已存方案`}/></div></div>
    {preview && <section className="panel preview-card" aria-busy={importPending}><div><span className={`format-badge ${preview.valid ? 'is-valid' : ''}`}>{preview.format}</span><h3>{preview.fileName}</h3><p>{preview.playerCount} 名球员 · {preview.eventCount} 个事件 · {preview.frameCount} 帧</p></div><div className="preview-card__warnings">{preview.warnings.map(item => <span key={item}>△ {item}</span>)}</div><div className="button-row"><button className="secondary" disabled={importPending} onClick={() => setPreview(null)}>取消</button><button className="primary" disabled={!preview.valid || importPending} onClick={() => void act(() => window.footballApi.commitImport(preview.token).then(result => { setPreview(null); return result }))}>确认导入</button></div></section>}
    <div className="two-columns"><section className="panel"><div className="panel__head"><div><span className="eyebrow">OPEN PROVIDER</span><h3>StatsBomb Open Data</h3></div><span className="status-tag">无需密钥</span></div><p>输入开放数据仓库中的比赛 ID，下载事件、阵容和可用的 360 空间快照。</p><div className="inline-form"><input value={props.statsBombId} onChange={e => props.setStatsBombId(e.target.value)} placeholder="比赛 ID，例如 3890561"/><button className="primary" disabled={!props.statsBombId} onClick={() => void act(() => window.footballApi.importStatsBombOpen(props.statsBombId))}>下载并导入</button></div><small className="attribution">使用数据时须注明：Data supplied by StatsBomb Open Data</small></section>
      <section className="panel"><div className="panel__head"><div><span className="eyebrow">METADATA PROVIDER</span><h3>football-data.org v4</h3></div><span className="status-tag status-tag--key">需要 Token</span></div><p>补充赛程、球队、比分、阵容和球员基础资料；不包含逐帧跑位。Token 的存储方式见设置。</p><div className="inline-form"><input type="password" value={props.footballDataToken} onChange={e => props.setFootballDataToken(e.target.value)} placeholder="API Token（仅用于数据源连接）"/><button className="secondary" disabled={!props.footballDataToken} onClick={() => void act(() => window.footballApi.saveFootballDataToken(props.footballDataToken))}>测试并使用</button></div><div className="inline-form inline-form--sub"><input value={props.footballDataMatchId} onChange={e => props.setFootballDataMatchId(e.target.value)} placeholder="比赛 ID"/><button className="primary" disabled={!props.footballDataMatchId} onClick={() => void act(() => window.footballApi.importFootballDataMatch(props.footballDataMatchId, props.footballDataToken))}>导入比赛</button></div></section></div>
    <section className="panel"><div className="panel__head"><div><span className="eyebrow">RECENT IMPORTS</span><h3>本地比赛库</h3></div><span>{matches.length} 场比赛</span></div>{matches.length ? <div className="match-table"><div className="match-row match-row--head"><span>比赛</span><span>赛事 / 赛季</span><span>数据覆盖</span><span>来源 / 操作</span></div>{matches.slice(0, 8).map(match => <div className="match-row" key={match.id}><strong>{match.homeTeam}<i>VS</i>{match.awayTeam}</strong><span>{match.competition}<small>{match.season}</small></span><span>{match.eventCount} 事件 · {match.frameCount} 帧</span><div className="match-actions"><span className="source-cell">{match.source}</span><button className="secondary" onClick={() => void props.onCreateScenario(match.id)}>生成校准方案</button></div></div>)}</div> : <div className="empty-state"><b>尚未导入比赛</b><p>载入合成示例或从开放数据开始。</p></div>}</section>
  </div>
}

function Quality({ label, value }: { label: string; value: number }) { return <div className="quality"><span>{label}<b>{value}%</b></span><div><i style={{ width: `${value}%` }}/></div></div> }

function PlayerProfiles({ scenario, selectedId, setSelectedId, setPage }: { scenario: TacticalScenario; selectedId: string; setSelectedId: (id: string) => void; setPage: (page: Page) => void }) {
  const [query, setQuery] = useState('')
  const all = [...scenario.home, ...scenario.away], selected = all.find(player => player.playerId === selectedId) ?? all[0]
  const visible = all.filter(player => `${player.name} ${player.position} ${player.role}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="players-layout"><section className="panel player-list"><div className="panel__head"><div><span className="eyebrow">SQUAD DATABASE</span><h3>球员档案</h3></div><span>{visible.length} / {all.length} 人</span></div><div className="player-search">⌕ <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索球员或位置"/></div>{visible.map(player => <button key={player.playerId} onClick={() => setSelectedId(player.playerId)} className={selected.playerId === player.playerId ? 'is-active' : ''}><span className={`mini-shirt mini-shirt--${player.side}`}>{player.shirtNumber}</span><div><strong>{player.name}</strong><small>{player.position} · {player.role}</small></div><em>{player.confidence === 'observed' ? '观测' : '模型'}</em></button>)}{!visible.length && <div className="empty-state"><b>没有匹配球员</b><p>尝试其他姓名或位置关键词。</p></div>}</section>
    <section className="player-detail"><div className="profile-hero"><span className={`profile-number profile-number--${selected.side}`}>{selected.shirtNumber}</span><div><span className="eyebrow">PLAYER TACTICAL PROFILE</span><h2>{selected.name}</h2><p>{selected.position} · {selected.role} · {selected.duty}</p></div><button className="primary" onClick={() => setPage('tactics')}>编辑战术职责</button></div><div className="profile-grid"><section className="panel"><h3>技术与决策</h3>{(Object.entries(selected.attributes) as Array<[keyof PlayerTacticalProfile['attributes'], number]>).map(([key, value]) => <Quality key={key} label={attributeLabels[key]} value={value}/>)}</section><section className="panel"><h3>行为倾向</h3><div className="radar-placeholder"><div className="radar-ring radar-ring--1"/><div className="radar-ring radar-ring--2"/><div className="radar-shape" style={{ clipPath: `polygon(50% ${100-selected.passForward}%, ${selected.passRisk}% 33%, ${selected.shootTendency}% 82%, ${100-selected.pressIntensity}% 82%, ${100-selected.carryTendency}% 33%)` }}/><span>向前传球</span><span>冒险传球</span><span>射门</span><span>压迫</span><span>带球</span></div></section><section className="panel profile-role"><h3>当前职责</h3><dl><div><dt>职责</dt><dd>{selected.duty}</dd></div><div><dt>跑位</dt><dd>{selected.runPattern}</dd></div><div><dt>站位</dt><dd>{selected.anchor.x.toFixed(1)}, {selected.anchor.y.toFixed(1)}</dd></div><div><dt>历史样本</dt><dd>{selected.historicalSampleSize ?? 0}</dd></div><div><dt>数据置信度</dt><dd>{selected.confidence === 'observed' ? '观测' : selected.confidence === 'modelled-high' ? '模型 · 高' : '模型 · 低'}</dd></div></dl><p>历史样本不足时，属性采用位置先验平滑，不会伪装成真实观测。</p></section></div></section>
  </div>
}

function TacticsEditor({ scenario, baseline, changeSummary, selected, selectedId, side, onTeamChange, onSelectPlayer, updatePlayer, movePlayer, updateTeamTactics, onRename, setPage, onReset, onUndo, onRedo, canUndo, canRedo, onSave, onContinuousEditStart, onContinuousEditEnd }: { scenario: TacticalScenario; baseline: TacticalScenario; changeSummary: ScenarioChangeSummary; selected: PlayerTacticalProfile; selectedId: string; side: TeamSide; onTeamChange: (side: TeamSide) => void; onSelectPlayer: (id: string) => void; updatePlayer: (changes: Partial<PlayerTacticalProfile>) => void; movePlayer: (id: string, point: Vec2) => void; updateTeamTactics: (key: 'homeTactics'|'awayTactics', field: string, value:number|string) => void; onRename: (name: string) => void; setPage: (page: Page) => void; onReset: () => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; historyVersion: number; onSave: () => void; onContinuousEditStart: () => void; onContinuousEditEnd: () => void }) {
  const tacticsKey = side === 'home' ? 'homeTactics' : 'awayTactics', tactics = scenario[tacticsKey]
  const teamSlider = { onEditStart: onContinuousEditStart, onEditEnd: onContinuousEditEnd }
  const baselineSelected = [...baseline.home, ...baseline.away].find(player => player.playerId === selected.playerId)
  return <div className="editor-layout"><section className="editor-main"><div className="editor-toolbar"><div className="segmented"><button className={side === 'home' ? 'is-active' : ''} onClick={() => onTeamChange('home')}>主队</button><button className={side === 'away' ? 'is-active' : ''} onClick={() => onTeamChange('away')}>客队</button></div><label>方案名称<input value={scenario.name} onFocus={onContinuousEditStart} onBlur={onContinuousEditEnd} onChange={e => onRename(e.target.value)}/></label><div className="editor-history" aria-label="编辑历史"><button className="secondary" disabled={!canUndo} onClick={onUndo}>撤销</button><button className="secondary" disabled={!canRedo} onClick={onRedo}>重做</button><button className="secondary" onClick={onReset}>恢复基准</button><button className="primary" onClick={onSave}>保存方案</button></div></div>
    <div className={`editor-change-summary ${changeSummary.total ? 'has-changes' : ''}`} role="status"><div><b>{changeSummary.total ? `已形成 ${changeSummary.total} 项可比较调整` : '当前方案与基准一致'}</b><span>{changeSummary.total ? `${changeSummary.playerCount} 名球员、${changeSummary.teamSettingCount} 项整体设置 · ${changeSummary.labels.join(' · ')}` : '选择球员修改职责、跑位或倾向，结果页才会显示战术差异。'}</span></div><button className="secondary" onClick={() => setPage('simulation')}>{changeSummary.total ? '运行对比推演' : '查看推演说明'} →</button></div>
    {scenario.calibration && <div className="calibration-strip"><span>历史校准</span><b>{scenario.calibration.provider}</b><em>{scenario.calibration.matchCount ?? 1} 场 · {scenario.calibration.eventCount} 事件 · {scenario.calibration.frameCount} 空间帧 · {scenario.calibration.lowSamplePlayers} 名低样本球员</em></div>}<div className="pitch-wrap"><Pitch home={scenario.home} away={scenario.away} selectedId={selectedId} onSelect={onSelectPlayer} onMove={movePlayer} onMoveStart={onContinuousEditStart} onMoveEnd={onContinuousEditEnd}/><div className="drag-hint">拖动球员调整站位 · 点击球员编辑职责</div></div><section className="panel team-tactics"><div className="panel__head"><h3>整体战术</h3><span>{side === 'home' ? '主队' : '客队'}</span></div><div className="team-tactics__grid"><Slider label="阵型宽度" value={tactics.width} onChange={value => updateTeamTactics(tacticsKey, 'width', value)} {...teamSlider}/><Slider label="阵型纵深" value={tactics.depth} onChange={value => updateTeamTactics(tacticsKey, 'depth', value)} {...teamSlider}/><Slider label="防线高度" value={tactics.defensiveLine} onChange={value => updateTeamTactics(tacticsKey, 'defensiveLine', value)} {...teamSlider}/><Slider label="压迫强度" value={tactics.pressing} onChange={value => updateTeamTactics(tacticsKey, 'pressing', value)} {...teamSlider}/><Slider label="转换速度" value={tactics.transitionSpeed} onChange={value => updateTeamTactics(tacticsKey, 'transitionSpeed', value)} {...teamSlider}/><label className="select-field"><span>组织方式</span><select value={tactics.buildUp} onChange={e => updateTeamTactics(tacticsKey, 'buildUp', e.target.value)}><option>短传组织</option><option>混合推进</option><option>快速直接</option></select></label><label className="select-field"><span>进攻侧重</span><select value={tactics.focus} onChange={e => updateTeamTactics(tacticsKey, 'focus', e.target.value)}><option>均衡</option><option>左路</option><option>中路</option><option>右路</option></select></label></div></section></section>
    <PlayerInspector selected={selected} baseline={baselineSelected} updatePlayer={updatePlayer} setPage={setPage} onContinuousEditStart={onContinuousEditStart} onContinuousEditEnd={onContinuousEditEnd}/></div>
}

const goalkeeperAttributeLabels: Record<keyof NonNullable<PlayerTacticalProfile['goalkeeping']>, string> = {
  shotStopping: '扑救能力', handling: '手控球', aerialReach: '制空范围', oneOnOnes: '一对一', rushingOut: '出击倾向', distribution: '出球能力'
}

function PlayerInspector({ selected, baseline, updatePlayer, setPage, onContinuousEditStart, onContinuousEditEnd }: { selected: PlayerTacticalProfile; baseline?: PlayerTacticalProfile; updatePlayer: (changes: Partial<PlayerTacticalProfile>) => void; setPage: (page: Page) => void; onContinuousEditStart: () => void; onContinuousEditEnd: () => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  useEffect(() => setShowAdvanced(false), [selected.playerId])
  const preset = getPlayerInstructionPreset(selected)
  const roleOptions = Array.from(new Set([selected.role, selected.position, ...preset.roles]))
  const isGoalkeeper = preset.group === 'goalkeeper'
  const goalkeeping = getGoalkeepingAttributes(selected)
  const baseAttributes = (Object.entries(selected.attributes) as Array<[keyof PlayerTacticalProfile['attributes'], number]>).filter(([key]) => !isGoalkeeper || ['passing', 'firstTouch', 'pace', 'stamina', 'decisions', 'vision'].includes(key))
  const confidence = selected.confidence === 'observed' ? '观测' : selected.confidence === 'modelled-high' ? '模型·高' : '模型·低'
  const continuousEdit = { onEditStart: onContinuousEditStart, onEditEnd: onContinuousEditEnd }
  const changes = describePlayerChanges(baseline, selected)

  const updateGoalkeeping = (key: keyof NonNullable<PlayerTacticalProfile['goalkeeping']>, value: number) => {
    updatePlayer({ goalkeeping: { ...goalkeeping, [key]: value } })
  }

  return <aside className="inspector" role="region" aria-label={`球员设置：${selected.name}`} data-testid="player-inspector" data-selected-player-id={selected.playerId}>
    <div className="inspector__head"><span className={`mini-shirt mini-shirt--${selected.side}`}>{selected.shirtNumber}</span><div><h3>{selected.name}</h3><p>{selected.position}</p></div><span className="confidence-mini">{confidence}</span></div>
    <div className="inspector__body">
      <div className={`position-guidance position-guidance--${preset.group}`}><b>{preset.label}</b><p>{preset.description}</p></div>
      <div className={`player-change-note ${changes.length ? 'has-changes' : ''}`}><b>{changes.length ? '相较基准' : '基准状态'}</b><span>{changes.length ? changes.slice(0, 3).join(' · ') : '该球员当前没有调整'}</span></div>
      <label className="select-field"><span>战术角色</span><select value={selected.role} onChange={event => updatePlayer({ role: event.target.value })}>{roleOptions.map(role => <option key={role}>{role}</option>)}</select></label>
      <label className="select-field"><span>职责</span><select value={selected.duty} onChange={event => updatePlayer({ duty: event.target.value as PlayerTacticalProfile['duty'] })}>{preset.duties.map(duty => <option key={duty}>{duty}</option>)}</select></label>
      <label className="select-field"><span>跑位模式</span><select value={selected.runPattern} onChange={event => updatePlayer({ runPattern: event.target.value as PlayerTacticalProfile['runPattern'] })}>{preset.runPatterns.map(pattern => <option key={pattern}>{pattern}</option>)}</select></label>
      {isGoalkeeper ? <>
        <div className="inspector__divider">核心指令</div>
        <Slider label="出球风险" value={selected.passRisk} onChange={value => updatePlayer({ passRisk: value })} {...continuousEdit}/><Slider label="开球距离" value={selected.passDirectness} onChange={value => updatePlayer({ passDirectness: value })} {...continuousEdit}/><Slider label="出击倾向" value={goalkeeping.rushingOut} onChange={value => updateGoalkeeping('rushingOut', value)} {...continuousEdit}/>
      </> : <>
        <div className="inspector__divider">核心倾向</div>
        <Slider label="传球冒险" value={selected.passRisk} onChange={value => updatePlayer({ passRisk: value })} {...continuousEdit}/><Slider label="向前传球" value={selected.passForward} onChange={value => updatePlayer({ passForward: value })} {...continuousEdit}/><Slider label="带球倾向" value={selected.carryTendency} onChange={value => updatePlayer({ carryTendency: value })} {...continuousEdit}/><Slider label="射门倾向" value={selected.shootTendency} onChange={value => updatePlayer({ shootTendency: value })} {...continuousEdit}/><Slider label="压迫强度" value={selected.pressIntensity} onChange={value => updatePlayer({ pressIntensity: value })} {...continuousEdit}/>
      </>}
      <button className="advanced-toggle" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(value => !value)}><span><b>专业参数</b><small>{isGoalkeeper ? '扑救、制空、基础能力' : '传球距离、盯人、技术属性'}</small></span>{showAdvanced ? '收起' : '展开'}</button>
      {showAdvanced && <div className="advanced-fields">{isGoalkeeper ? <>
        <div className="inspector__divider">门将专项</div>
        {(Object.entries(goalkeeping) as Array<[keyof NonNullable<PlayerTacticalProfile['goalkeeping']>, number]>).filter(([key]) => key !== 'rushingOut').map(([key, value]) => <Slider key={key} label={goalkeeperAttributeLabels[key]} value={value} onChange={next => updateGoalkeeping(key, next)} {...continuousEdit}/>)}
      </> : <><div className="inspector__divider">补充倾向</div><Slider label="传球距离" value={selected.passDirectness} onChange={value => updatePlayer({ passDirectness: value })} {...continuousEdit}/><Slider label="盯人职责" value={selected.marking} onChange={value => updatePlayer({ marking: value })} {...continuousEdit}/></>}
        <div className="inspector__divider">{isGoalkeeper ? '基础能力' : '技术与身体属性'}</div>
        {baseAttributes.map(([key, value]) => <Slider key={key} label={attributeLabels[key]} value={value} onChange={next => updatePlayer({ attributes: { ...selected.attributes, [key]: next } })} {...continuousEdit}/>)}
      </div>}
    </div>
    <div className="inspector__footer"><button className="primary" onClick={() => setPage('simulation')}>进入推演实验室 →</button></div>
  </aside>
}

function SimulationLab({ scenario, changeSummary, setPage, setScenario, comparison, comparisonScenario, comparisonChanges, comparisonIsStale, running, isBrowser, progress, runSimulation, cancel, replayActions, replayMode, setReplayMode, replayStep, setReplayStep, exportResult }: { scenario: TacticalScenario; changeSummary: ScenarioChangeSummary; setPage: (page: Page) => void; setScenario: React.Dispatch<React.SetStateAction<TacticalScenario>>; comparison: SimulationComparison | null; comparisonScenario: TacticalScenario | null; comparisonChanges: ScenarioChangeSummary; comparisonIsStale: boolean; running: boolean; isBrowser: boolean; progress: { value: number; phase: string }; runSimulation: () => void; cancel: () => void; replayActions: SimulationAction[]; replayMode: 'success'|'failure'; setReplayMode: (mode:'success'|'failure') => void; replayStep: number; setReplayStep: (step:number) => void; exportResult: (format:'json'|'csv'|'pdf') => void }) {
  const [resultView, setResultView] = useState<'overview' | 'replay' | 'method'>('overview')
  useEffect(() => { if (comparison) setResultView('overview') }, [comparison])
  const metricRows = comparison ? presentComparisonMetrics(comparison) : []
  const verdict = comparison ? buildComparisonVerdict(comparison, comparisonChanges.total > 0) : null
  const replayScenario = comparisonScenario ?? scenario
  const maxReplayStep = Math.max(0, replayActions.length - 1)
  const safeReplayStep = Math.min(Math.max(0, replayStep), maxReplayStep)
  const activeAction = replayActions[safeReplayStep]

  return <div className="content-stack"><section className="simulation-command"><div><span className="eyebrow">MONTE CARLO / POSSESSION ENGINE</span><h2>把战术调整，放进同一场实验。</h2><p>相同随机种子与样本量，对照职责、空间压力、技术属性和历史先验。先看取舍，再核查回合。</p></div><div className="run-controls"><label>推演次数<select disabled={running} value={scenario.iterations} onChange={e => setScenario(current => ({ ...current, iterations: Number(e.target.value) }))}><option value="300">300</option><option value="1200">1,200</option><option value="5000">5,000</option><option value="10000">10,000</option></select></label><label>随机种子<input disabled={running} type="number" step="1" value={scenario.seed} onChange={e => { const seed = e.target.valueAsNumber; if (Number.isSafeInteger(seed)) setScenario(current => ({ ...current, seed })) }}/></label>{running ? <button className="danger" onClick={cancel}>取消推演</button> : <button className="run-button" onClick={runSimulation}>运行对比推演</button>}</div></section>
    <div className={`simulation-change-context ${changeSummary.total ? 'has-changes' : ''}`}><div><b>{changeSummary.total ? `将比较 ${changeSummary.total} 项战术调整` : '尚未检测到战术调整'}</b><span>{changeSummary.total ? `${changeSummary.playerCount} 名球员 · ${changeSummary.teamSettingCount} 项整体设置 · ${changeSummary.labels.join(' · ')}` : '直接运行可验证基准一致性，但不会产生有意义的战术差异。'}</span></div><button className="secondary" onClick={() => setPage('tactics')}>{changeSummary.total ? '检查修改' : '前往战术编辑器'}</button></div>
    {running && <div className="running-panel"><span className="spinner"/><div><strong>{progress.phase} · {Math.round(progress.value * 100)}%</strong><p>界面保持响应，可随时取消。核心引擎未调用 AI。</p></div><div className="running-progress">{Math.round(progress.value * scenario.iterations * 2).toLocaleString()} / {(scenario.iterations * 2).toLocaleString()} 回合</div><div className="running-line"><i style={{ width: `${Math.max(1, progress.value * 100)}%` }}/></div></div>}
    {!comparison && !running && <div className="empty-simulation"><div className="simulation-orbit"><span>▶</span></div><h3>{changeSummary.total ? '战术调整已准备好' : '先调整战术，结果会更有价值'}</h3><p>{changeSummary.total ? '运行后将优先展示结论摘要，再按需查看回放和模型说明。' : '你也可以直接运行一次基准校验；结果页会明确标注“无明显变化”。'}</p><div className="scenario-facts"><span>双方球员可编辑</span><span>{scenario.iterations.toLocaleString()} 次回合</span><span>固定种子 {scenario.seed}</span></div></div>}
    {comparison && !running && <><div className="results-head"><div><span className="eyebrow">COMPARISON RESULT</span><h2>战术调整对比结果</h2></div><div className="button-row"><button className="secondary" onClick={() => exportResult('json')}>导出 JSON</button><button className="secondary" onClick={() => exportResult('csv')}>导出 CSV</button><button className="primary" onClick={() => exportResult('pdf')}>{isBrowser ? '打印 / 保存 PDF' : '导出 PDF 报告'}</button></div></div>
      {comparisonIsStale && <div className="result-stale" role="status"><div><b>当前设置已在本次结果生成后发生变化</b><span>下面仍展示上一轮实验，回放与改动摘要均已锁定到当时的方案。重新运行后才会更新结果。</span></div><button className="primary" onClick={runSimulation}>按当前设置重新推演</button></div>}
      <div className="result-tabs" role="tablist" aria-label="结果视图"><button role="tab" aria-selected={resultView === 'overview'} className={resultView === 'overview' ? 'is-active' : ''} onClick={() => setResultView('overview')}>结论摘要</button><button role="tab" aria-selected={resultView === 'replay'} className={resultView === 'replay' ? 'is-active' : ''} onClick={() => setResultView('replay')}>回合回放</button><button role="tab" aria-selected={resultView === 'method'} className={resultView === 'method' ? 'is-active' : ''} onClick={() => setResultView('method')}>模型与置信度</button></div>
      <p className="panel-footnote">差值按未舍入原值计算，可能与展示数值的直接相减略有不同。“无明显变化”为显示阈值判断，方向性结论不等同于统计显著性，请结合样本量与置信区间解读。</p>
      {resultView === 'overview' && verdict && <div role="tabpanel" className="result-overview"><section className={`result-verdict result-verdict--${verdict.tone}`}><span>概率分析结论</span><div><h3>{verdict.title}</h3><p>{verdict.summary}</p><ul>{verdict.highlights.map(item => <li key={item}>{item}</li>)}</ul></div></section><div className="results-grid">{metricRows.map(metric => <ComparisonMetricCard key={metric.key} metric={metric}/>)}</div><div className="result-support-grid"><section className="panel"><span className="eyebrow">ATTACKING LANES</span><h3>修改方案的进攻通道</h3><Lane label="左路" value={comparison.modified.metrics.leftShare}/><Lane label="中路" value={comparison.modified.metrics.centreShare}/><Lane label="右路" value={comparison.modified.metrics.rightShare}/><p className="panel-footnote">占比描述进攻分布，不单独代表效率高低。</p></section><section className="panel"><span className="eyebrow">SCENARIO CHANGES</span><h3>本次比较包含什么</h3>{comparisonChanges.total ? <ul className="change-list"><li>{comparisonChanges.playerCount} 名球员发生职责、站位或倾向调整</li><li>{comparisonChanges.teamSettingCount} 项整体战术设置发生变化</li>{comparisonChanges.changedPlayerNames.slice(0, 5).map(name => <li key={name}>{name}</li>)}</ul> : <p className="quality-note">基准与修改方案没有参数差异，本次结果仅用于验证计算一致性。</p>}<button className="secondary" onClick={() => setPage('tactics')}>返回检查战术设置</button></section></div></div>}
      {resultView === 'replay' && <div role="tabpanel" className="result-layout"><section className="panel replay-panel"><div className="panel__head"><div><h3>代表性回合回放</h3><span>虚线代表传球，轨迹为模型推断</span></div><div className="segmented segmented--small"><button className={replayMode==='success'?'is-active':''} aria-pressed={replayMode === 'success'} onClick={() => {setReplayMode('success');setReplayStep(0)}}>成功机会</button><button className={replayMode==='failure'?'is-active':''} aria-pressed={replayMode === 'failure'} onClick={() => {setReplayMode('failure');setReplayStep(0)}}>失去球权</button></div></div><Pitch home={replayScenario.home} away={replayScenario.away} actions={replayActions} step={safeReplayStep}/><div className="replay-controls"><button aria-label="上一步" onClick={() => setReplayStep(Math.max(0, safeReplayStep - 1))}>‹</button><input aria-label="回放步骤" type="range" min="0" max={maxReplayStep} value={safeReplayStep} onChange={e => setReplayStep(Number(e.target.value))}/><button aria-label="下一步" onClick={() => setReplayStep(Math.min(maxReplayStep, safeReplayStep + 1))}>›</button><span>{replayActions.length ? safeReplayStep + 1 : 0} / {replayActions.length}</span></div>{activeAction && <div className="action-caption"><b>{actionLabels[activeAction.kind]}</b>{activeAction.note}<span>动作成功概率 {percent(activeAction.probability)}</span></div>}</section><aside className="analysis-side"><section className="panel replay-help"><span className="eyebrow">HOW TO READ</span><h3>如何阅读回合</h3><ol><li>切换“成功机会”和“失去球权”观察两类典型路径。</li><li>逐步查看球员、目标和动作成功概率。</li><li>代表性回合用于解释机制，不代表出现频率最高。</li></ol></section></aside></div>}
      {resultView === 'method' && <div role="tabpanel" className="method-grid"><section className="panel"><span className="eyebrow">MODEL NOTES</span><h3>数据与模型说明</h3>{comparison.modified.qualityNotes.map(note => <p className="model-note" key={note}>· {note}</p>)}</section><section className="panel"><span className="eyebrow">UNCERTAINTY</span><h3>95% 置信区间</h3><div className="confidence-table"><span>射门回合率<b>{percent(comparison.modified.confidenceInterval.shotRate[0])} – {percent(comparison.modified.confidenceInterval.shotRate[1])}</b></span><span>控球延续率<b>{percent(comparison.modified.confidenceInterval.retentionRate[0])} – {percent(comparison.modified.confidenceInterval.retentionRate[1])}</b></span><span>样本量<b>{comparison.modified.metrics.possessions.toLocaleString()} 回合</b></span><span>随机种子<b>{comparison.modified.seed}</b></span></div><p className="panel-footnote">区间越窄，估计越稳定；区间不等同于真实比赛结果保证。</p></section></div>}
    </>}
  </div>
}

function ComparisonMetricCard({ metric }: { metric: ReturnType<typeof presentComparisonMetrics>[number] }) {
  const symbol = metric.tone === 'positive' ? '↑' : metric.tone === 'negative' ? '↓' : '—'
  return <article className={`comparison-metric comparison-metric--${metric.tone}`} aria-label={`${metric.label}：修改方案 ${metric.modified}，基准 ${metric.baseline}，${metric.deltaText}`}><div className="comparison-metric__head"><span>{metric.label}</span><em>{symbol} {metric.deltaText}</em></div><strong>{metric.modified}</strong><small>基准 {metric.baseline}</small></article>
}
function Lane({label,value}:{label:string;value:number}) { return <div className="lane"><span>{label}<b>{percent(value)}</b></span><div><i style={{width:percent(value)}}/></div></div> }

function Settings({ appInfo, summary, onBackup }: { appInfo: {version:string;databasePath:string;platform:string}; summary: DatabaseSummary; onBackup:()=>void }) {
  const browser = appInfo.platform === 'Browser'
  return <div className="settings-grid">
    <section className="panel settings-section"><span className="eyebrow">APPLICATION / STORAGE</span><h2>{browser ? '浏览器工作台' : '桌面应用'}</h2><dl className="settings-list"><div><dt>版本</dt><dd>{appInfo.version}</dd></div><div><dt>平台</dt><dd>{browser ? '浏览器' : appInfo.platform}</dd></div><div><dt>数据位置</dt><dd title={appInfo.databasePath}>{appInfo.databasePath}</dd></div><div><dt>本地数据</dt><dd>{summary.matches} 场比赛 · {summary.events} 个事件</dd></div></dl><button className="secondary" onClick={onBackup}>{browser ? '下载数据备份' : '备份 SQLite 数据库'}</button>{browser && <p>备份可在数据中心重新导入，恢复比赛与战术方案。清理浏览器网站数据会删除本地数据库，换设备或浏览器不会自动同步。</p>}</section>
    <section className="panel settings-section"><span className="eyebrow">PRIVACY / LOCAL FIRST</span><h2>计算发生在你的设备。</h2><ul className="security-list"><li><div><b>{browser ? '浏览器本地存储' : '上下文隔离'}</b><p>{browser ? '导入比赛和战术方案保存在当前浏览器 IndexedDB，核心推演在 Web Worker 中运行。' : '渲染器无法直接访问 Node.js 或文件系统。'}</p></div></li><li><div><b>{browser ? 'Token 仅当前会话' : 'Token 系统加密'}</b><p>{browser ? 'football-data.org Token 只保留在当前页面内存；刷新后需重新输入。连接该数据源时，经本站受限代理发送到 football-data.org，不入库、不写日志。' : 'API Token 使用 Electron safeStorage，不进入数据库、日志或 Git。'}</p></div></li><li><div><b>本地概率推演</b><p>下载数据需要网络，已导入数据的战术计算不调用远程模型。浏览器版首次打开页面需要网络。</p></div></li></ul></section>
    <section className="panel settings-section ai-disabled"><div className="ai-disabled__title"><span>AI</span><div><span className="eyebrow">EXTENSION / DISABLED</span><h2>AI 分析接口</h2></div><em>未启用</em></div><p>已预留扩展接口。战术推演、指标对比与结论摘要均由本地确定性规则和概率引擎生成；无需配置 AI 密钥。</p></section>
    <section className="panel settings-section"><span className="eyebrow">DATA / ATTRIBUTION</span><h2>数据来源</h2><p>StatsBomb Open Data 提供事件、阵容和部分 360 快照；使用分析成果时须保留来源声明。football-data.org 提供订阅允许的比赛元数据。</p><div className="provider-links"><a href="https://github.com/statsbomb/open-data">StatsBomb Open Data</a><a href="https://www.football-data.org/documentation/quickstart">football-data.org 文档</a><a href="https://mossnyx.xyz/">返回 Mossnyx</a></div></section>
  </div>
}

export default App
