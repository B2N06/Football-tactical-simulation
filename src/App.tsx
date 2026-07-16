import { useEffect, useMemo, useRef, useState } from 'react'
import { Pitch } from './components/Pitch'
import { MetricCard } from './components/MetricCard'
import { TeamAnalysisPage } from './components/TeamAnalysisPage'
import { createDemoScenario } from './engine/demo'
import { createScenarioFromBundles } from './engine/history'
import { getPlayerSide } from './engine/scenario'
import { getGoalkeepingAttributes, getPlayerInstructionPreset } from './engine/playerInstructions'
import type { DatabaseSummary, ImportPreview, PlayerTacticalProfile, SimulationAction, SimulationComparison, StoredMatchSummary, TacticalScenario, TeamSide, Vec2 } from './types'

type Page = 'data' | 'analysis' | 'team' | 'players' | 'tactics' | 'simulation' | 'settings'

const nav: Array<{ id: Page; label: string; icon: string }> = [
  { id: 'data', label: '数据中心', icon: '◫' }, { id: 'analysis', label: '比赛分析', icon: '⌁' }, { id: 'team', label: '球队分析', icon: '◈' },
  { id: 'players', label: '球员档案', icon: '◎' }, { id: 'tactics', label: '战术编辑器', icon: '✣' },
  { id: 'simulation', label: '推演实验室', icon: '▶' }, { id: 'settings', label: '设置', icon: '⚙' }
]

const emptySummary: DatabaseSummary = { matches: 0, teams: 0, players: 0, events: 0, frames: 0, scenarios: 0 }
const clone = <T,>(value: T): T => structuredClone(value)
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const signed = (value: number, scale = 100) => `${value >= 0 ? '+' : ''}${(value * scale).toFixed(1)}${scale === 100 ? '%' : ''}`
const attributeLabels: Record<keyof PlayerTacticalProfile['attributes'], string> = { passing:'传球', firstTouch:'停球', dribbling:'盘带', shooting:'射门', pace:'速度', stamina:'耐力', decisions:'决策', vision:'视野' }

function Slider({ label, value, onChange, hint }: { label: string; value: number; onChange: (value: number) => void; hint?: string }) {
  return <label className="slider-field"><span>{label}<b>{value}</b></span><input type="range" min="0" max="100" value={value} onChange={event => onChange(Number(event.target.value))}/>{hint && <small>{hint}</small>}</label>
}

function App() {
  const [page, setPage] = useState<Page>('data')
  const [summary, setSummary] = useState<DatabaseSummary>(emptySummary)
  const [matches, setMatches] = useState<StoredMatchSummary[]>([])
  const [baseline, setBaseline] = useState<TacticalScenario>(() => createDemoScenario())
  const [scenario, setScenario] = useState<TacticalScenario>(() => clone(createDemoScenario()))
  const [selectedId, setSelectedId] = useState('home-10')
  const [side, setSide] = useState<TeamSide>('home')
  const [comparison, setComparison] = useState<SimulationComparison | null>(null)
  const [running, setRunning] = useState(false)
  const [simulationProgress, setSimulationProgress] = useState({ value: 0, phase: '准备计算' })
  const [replayStep, setReplayStep] = useState(0)
  const [replayMode, setReplayMode] = useState<'success' | 'failure'>('success')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [statsBombId, setStatsBombId] = useState('')
  const [footballDataToken, setFootballDataToken] = useState('')
  const [footballDataMatchId, setFootballDataMatchId] = useState('')
  const [appInfo, setAppInfo] = useState({ version: '0.4.0', databasePath: '正在读取…', platform: 'Windows x64' })
  const workerRef = useRef<Worker | null>(null)

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

  const players = side === 'home' ? scenario.home : scenario.away
  const selected = useMemo(() => [...scenario.home, ...scenario.away].find(player => player.playerId === selectedId) ?? scenario.home[0], [scenario, selectedId])
  const replayActions = comparison ? (replayMode === 'success' ? comparison.modified.representativeSuccess : comparison.modified.representativeFailure) : []

  const updatePlayer = (changes: Partial<PlayerTacticalProfile>) => setScenario(current => ({ ...current,
    home: current.home.map(player => player.playerId === selectedId ? { ...player, ...changes } : player),
    away: current.away.map(player => player.playerId === selectedId ? { ...player, ...changes } : player)
  }))
  const selectPlayer = (id: string) => { setSelectedId(id); setSide(getPlayerSide(scenario, id)) }
  const selectTeam = (nextSide: TeamSide) => { setSide(nextSide); setSelectedId(scenario[nextSide][0].playerId) }
  const movePlayer = (id: string, anchor: Vec2) => {
    const targetSide = getPlayerSide(scenario, id)
    setSelectedId(id); setSide(targetSide)
    setScenario(current => ({ ...current, [targetSide]: current[targetSide].map(player => player.playerId === id ? { ...player, anchor } : player) }))
  }
  const updateTeamTactics = (key: 'homeTactics' | 'awayTactics', field: string, value: number | string) => setScenario(current => ({ ...current, [key]: { ...current[key], [field]: value } }))

  const act = async (operation: () => Promise<{ message?: string; summary?: DatabaseSummary }>) => {
    setNotice(null)
    try { const result = await operation(); if (result.summary) setSummary(result.summary); await refreshData(); setNotice({ kind: 'ok', text: result.message ?? '操作完成。' }) }
    catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
  }

  const createScenarioFromMatch = async (matchId: string) => {
    setNotice(null)
    try {
      const next = createScenarioFromBundles(await window.footballApi.getRelatedMatchBundles(matchId))
      setBaseline(clone(next)); setScenario(clone(next)); setSelectedId(next.home[0].playerId); setSide('home'); setComparison(null); setPage('tactics')
      setNotice({ kind: 'ok', text: `已汇总 ${next.calibration?.matchCount ?? 1} 场相关比赛：${next.calibration?.eventCount ?? 0} 个事件、${next.calibration?.frameCount ?? 0} 个空间帧参与校准。` })
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
  }

  const resetScenario = () => {
    const next = clone(baseline)
    setScenario(next); setSelectedId(next.home[0].playerId); setSide('home'); setComparison(null)
  }

  const runSimulation = () => {
    setNotice(null); setRunning(true); setComparison(null); setSimulationProgress({ value: 0, phase: '正在计算基准方案' })
    const worker = new Worker(new URL('./engine/simulation.worker.ts', import.meta.url), { type: 'module' })
    const baselineForRun = { ...baseline, iterations: scenario.iterations, seed: scenario.seed, maxActions: scenario.maxActions }
    workerRef.current = worker
    worker.onmessage = event => {
      if (event.data.type === 'progress') {
        setSimulationProgress({ value: event.data.progress, phase: event.data.phase === 'baseline' ? '正在计算基准方案' : '正在计算修改方案' })
        return
      }
      setRunning(false); workerRef.current = null; worker.terminate()
      if (event.data.ok) { setComparison(event.data.result); setReplayStep(0); void window.footballApi.saveScenario(scenario); setNotice({ kind: 'ok', text: `已完成 ${scenario.iterations.toLocaleString()} × 2 次独立进攻回合推演。` }) }
      else setNotice({ kind: 'error', text: event.data.error })
    }
    worker.onerror = event => { setRunning(false); workerRef.current = null; worker.terminate(); setNotice({ kind: 'error', text: event.message || '后台推演失败' }) }
    worker.postMessage({ baseline: baselineForRun, modified: scenario })
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand__mark"><span>FT</span></div><div><strong>Football</strong><small>Tactical Simulation</small></div></div>
      <div className="workspace-label">工作空间</div>
      <nav>{nav.map(item => <button key={item.id} className={page === item.id ? 'is-active' : ''} onClick={() => setPage(item.id)}><i>{item.icon}</i><span>{item.label}</span>{item.id === 'simulation' && comparison && <em/>}</button>)}</nav>
      <div className="sidebar__source"><span className="pulse-dot"/><div><strong>离线核心已就绪</strong><small>AI 未启用 · 本地计算</small></div></div>
      <div className="sidebar__foot">v{appInfo.version}<span>概率分析引擎</span></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><p>FOOTBALL INTELLIGENCE WORKSPACE</p><h1>{nav.find(item => item.id === page)?.label}</h1></div><div className="topbar__actions"><span className="confidence-pill">● 模型状态：可用</span><button className="icon-button" title="打开设置" onClick={() => setPage('settings')}>⚙</button></div></header>
      {notice && <div className={`notice notice--${notice.kind}`}><span>{notice.kind === 'ok' ? '✓' : '!'}</span>{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
      <section className="page-content">
        {page === 'data' && <DataCenter summary={summary} matches={matches} preview={preview} setPreview={setPreview} statsBombId={statsBombId} setStatsBombId={setStatsBombId} footballDataToken={footballDataToken} setFootballDataToken={setFootballDataToken} footballDataMatchId={footballDataMatchId} setFootballDataMatchId={setFootballDataMatchId} act={act} onCreateScenario={createScenarioFromMatch}/>}
        {page === 'analysis' && <MatchAnalysis matches={matches} scenario={scenario}/>} 
        {page === 'team' && <TeamAnalysisPage matches={matches} onCreateScenario={createScenarioFromMatch}/>}
        {page === 'players' && <PlayerProfiles scenario={scenario} selectedId={selectedId} setSelectedId={selectPlayer} setPage={setPage}/>}
        {page === 'tactics' && <TacticsEditor scenario={scenario} selected={selected} selectedId={selectedId} side={side} onTeamChange={selectTeam} onSelectPlayer={selectPlayer} updatePlayer={updatePlayer} movePlayer={movePlayer} updateTeamTactics={updateTeamTactics} setScenario={setScenario} setPage={setPage} onReset={resetScenario}/>}
        {page === 'simulation' && <SimulationLab scenario={scenario} setScenario={setScenario} comparison={comparison} running={running} progress={simulationProgress} runSimulation={runSimulation} cancel={() => { workerRef.current?.terminate(); workerRef.current = null; setRunning(false); setSimulationProgress({ value: 0, phase: '已取消' }); setNotice({ kind: 'error', text: '推演已取消。' }) }} replayActions={replayActions} replayMode={replayMode} setReplayMode={setReplayMode} replayStep={replayStep} setReplayStep={setReplayStep} exportResult={(format) => comparison && act(() => window.footballApi.exportResult(format, comparison).then(result => ({ message: result.ok ? `已导出到 ${result.path}` : '已取消导出。' })))}/>}
        {page === 'settings' && <Settings appInfo={appInfo} summary={summary} onBackup={() => act(() => window.footballApi.backupDatabase().then(result => ({ message: result.ok ? `备份已保存到 ${result.path}` : '已取消备份。' })))}/>}
      </section>
    </main>
  </div>
}

function DataCenter(props: { summary: DatabaseSummary; matches: StoredMatchSummary[]; preview: ImportPreview | null; setPreview: (value: ImportPreview | null) => void; statsBombId: string; setStatsBombId: (value: string) => void; footballDataToken: string; setFootballDataToken: (value: string) => void; footballDataMatchId: string; setFootballDataMatchId: (value: string) => void; act: (operation: () => Promise<{ message?: string; summary?: DatabaseSummary }>) => Promise<void>; onCreateScenario: (matchId: string) => Promise<void> }) {
  const { summary, matches, preview, setPreview, act } = props
  const chooseFile = async () => { try { setPreview(await window.footballApi.previewImport()) } catch (error) { await act(() => Promise.reject(error)) } }
  return <div className="content-stack">
    <div className="hero-grid"><section className="hero-panel"><div className="eyebrow">LOCAL DATA VAULT</div><h2>把比赛变成<br/><span>可推演的战术资产</span></h2><p>事件、360 空间快照、逐帧坐标和球员档案统一归一到 105 × 68 米球场。所有核心分析均在本地完成。</p><div className="hero-panel__actions"><button className="primary" onClick={chooseFile}>＋ 导入本地数据</button><button className="secondary" onClick={() => void act(() => window.footballApi.seedDemo())}>载入合成示例</button></div></section><div className="summary-grid"><MetricCard label="比赛" value={summary.matches.toLocaleString()} hint="本地数据库"/><MetricCard label="比赛事件" value={summary.events.toLocaleString()} hint="传球、射门、推进等"/><MetricCard label="空间快照" value={summary.frames.toLocaleString()} hint="观测追踪数据"/><MetricCard label="球员档案" value={summary.players.toLocaleString()} hint={`${summary.scenarios} 个已存方案`}/></div></div>
    {preview && <section className="panel preview-card"><div><span className={`format-badge ${preview.valid ? 'is-valid' : ''}`}>{preview.format}</span><h3>{preview.fileName}</h3><p>{preview.playerCount} 名球员 · {preview.eventCount} 个事件 · {preview.frameCount} 帧</p></div><div className="preview-card__warnings">{preview.warnings.map(item => <span key={item}>△ {item}</span>)}</div><div className="button-row"><button className="secondary" onClick={() => setPreview(null)}>取消</button><button className="primary" disabled={!preview.valid} onClick={() => void act(() => window.footballApi.commitImport(preview.token).then(result => { setPreview(null); return result }))}>确认导入</button></div></section>}
    <div className="two-columns"><section className="panel"><div className="panel__head"><div><span className="eyebrow">OPEN PROVIDER</span><h3>StatsBomb Open Data</h3></div><span className="status-tag">无需密钥</span></div><p>输入开放数据仓库中的比赛 ID，下载事件、阵容和可用的 360 空间快照。</p><div className="inline-form"><input value={props.statsBombId} onChange={e => props.setStatsBombId(e.target.value)} placeholder="比赛 ID，例如 3890561"/><button className="primary" disabled={!props.statsBombId} onClick={() => void act(() => window.footballApi.importStatsBombOpen(props.statsBombId))}>下载并导入</button></div><small className="attribution">使用数据时须注明：Data supplied by StatsBomb Open Data</small></section>
      <section className="panel"><div className="panel__head"><div><span className="eyebrow">METADATA PROVIDER</span><h3>football-data.org v4</h3></div><span className="status-tag status-tag--key">需要 Token</span></div><p>补充赛程、球队、比分、阵容和球员基础资料；不包含逐帧跑位。</p><div className="inline-form"><input type="password" value={props.footballDataToken} onChange={e => props.setFootballDataToken(e.target.value)} placeholder="API Token（系统加密存储）"/><button className="secondary" disabled={!props.footballDataToken} onClick={() => void act(() => window.footballApi.saveFootballDataToken(props.footballDataToken))}>测试并保存</button></div><div className="inline-form inline-form--sub"><input value={props.footballDataMatchId} onChange={e => props.setFootballDataMatchId(e.target.value)} placeholder="比赛 ID"/><button className="primary" disabled={!props.footballDataMatchId} onClick={() => void act(() => window.footballApi.importFootballDataMatch(props.footballDataMatchId, props.footballDataToken))}>导入比赛</button></div></section></div>
    <section className="panel"><div className="panel__head"><div><span className="eyebrow">RECENT IMPORTS</span><h3>本地比赛库</h3></div><span>{matches.length} 场比赛</span></div>{matches.length ? <div className="match-table"><div className="match-row match-row--head"><span>比赛</span><span>赛事 / 赛季</span><span>数据覆盖</span><span>来源 / 操作</span></div>{matches.slice(0, 8).map(match => <div className="match-row" key={match.id}><strong>{match.homeTeam}<i>VS</i>{match.awayTeam}</strong><span>{match.competition}<small>{match.season}</small></span><span>{match.eventCount} 事件 · {match.frameCount} 帧</span><div className="match-actions"><span className="source-cell">{match.source}</span><button className="secondary" onClick={() => void props.onCreateScenario(match.id)}>生成校准方案</button></div></div>)}</div> : <div className="empty-state"><b>尚未导入比赛</b><p>载入合成示例或从开放数据开始。</p></div>}</section>
  </div>
}

function MatchAnalysis({ matches, scenario }: { matches: StoredMatchSummary[]; scenario: TacticalScenario }) {
  const [active, setActive] = useState(0)
  const match = matches[active]
  return <div className="content-stack"><div className="section-intro"><div><span className="eyebrow">MATCH EXPLORER</span><h2>比赛数据质量与空间分析</h2><p>观测数据和模型推断始终分层展示。</p></div><select value={active} onChange={event => setActive(Number(event.target.value))}>{matches.length ? matches.map((item, index) => <option value={index} key={item.id}>{item.homeTeam} vs {item.awayTeam}</option>) : <option>合成示例</option>}</select></div>
    <div className="analysis-layout"><section className="panel pitch-panel"><div className="panel__head"><div><h3>{match ? `${match.homeTeam} vs ${match.awayTeam}` : scenario.name}</h3><span>{match?.competition ?? '战术实验示例'}</span></div><span className="status-tag">模型阵型</span></div><Pitch home={scenario.home} away={scenario.away}/><div className="pitch-legend"><span><i className="home-dot"/>主队</span><span><i className="away-dot"/>客队</span><span>虚线轨迹 = 模型推断</span></div></section><aside className="analysis-side"><section className="panel"><span className="eyebrow">DATA CONFIDENCE</span><h3>数据覆盖</h3><Quality label="事件数据" value={match?.eventCount ? 94 : 18}/><Quality label="逐帧追踪" value={match?.frameCount ? 82 : 0}/><Quality label="球员属性" value={match ? 61 : 48}/><p className="quality-note">{match?.frameCount ? '包含观测空间快照，可用于校准场上距离与压力。' : '缺少追踪坐标。无球跑位将以职责模板推断并明确标记。'}</p></section><section className="panel"><span className="eyebrow">OBSERVATIONS</span><h3>可用分析</h3><ul className="check-list"><li>传球方向与距离分布</li><li>推进和丢失球权区域</li><li>球员接球及射门位置</li><li className={!match?.frameCount ? 'is-muted' : ''}>360 空间压力与防线结构</li></ul></section></aside></div></div>
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

function TacticsEditor({ scenario, selected, selectedId, side, onTeamChange, onSelectPlayer, updatePlayer, movePlayer, updateTeamTactics, setScenario, setPage, onReset }: { scenario: TacticalScenario; selected: PlayerTacticalProfile; selectedId: string; side: TeamSide; onTeamChange: (side: TeamSide) => void; onSelectPlayer: (id: string) => void; updatePlayer: (changes: Partial<PlayerTacticalProfile>) => void; movePlayer: (id: string, point: Vec2) => void; updateTeamTactics: (key: 'homeTactics'|'awayTactics', field: string, value:number|string) => void; setScenario: React.Dispatch<React.SetStateAction<TacticalScenario>>; setPage: (page: Page) => void; onReset: () => void }) {
  const tacticsKey = side === 'home' ? 'homeTactics' : 'awayTactics', tactics = scenario[tacticsKey]
  return <div className="editor-layout"><section className="editor-main"><div className="editor-toolbar"><div className="segmented"><button className={side === 'home' ? 'is-active' : ''} onClick={() => onTeamChange('home')}>主队</button><button className={side === 'away' ? 'is-active' : ''} onClick={() => onTeamChange('away')}>客队</button></div><label>方案名称<input value={scenario.name} onChange={e => setScenario(current => ({ ...current, name: e.target.value }))}/></label><button className="secondary" onClick={onReset}>恢复基准</button></div>{scenario.calibration && <div className="calibration-strip"><span>历史校准</span><b>{scenario.calibration.provider}</b><em>{scenario.calibration.matchCount ?? 1} 场 · {scenario.calibration.eventCount} 事件 · {scenario.calibration.frameCount} 空间帧 · {scenario.calibration.lowSamplePlayers} 名低样本球员</em></div>}<div className="pitch-wrap"><Pitch home={scenario.home} away={scenario.away} selectedId={selectedId} onSelect={onSelectPlayer} onMove={movePlayer}/><div className="drag-hint">拖动球员调整站位 · 点击球员编辑职责</div></div><section className="panel team-tactics"><div className="panel__head"><h3>整体战术</h3><span>{side === 'home' ? '主队' : '客队'}</span></div><div className="team-tactics__grid"><Slider label="阵型宽度" value={tactics.width} onChange={value => updateTeamTactics(tacticsKey, 'width', value)}/><Slider label="阵型纵深" value={tactics.depth} onChange={value => updateTeamTactics(tacticsKey, 'depth', value)}/><Slider label="防线高度" value={tactics.defensiveLine} onChange={value => updateTeamTactics(tacticsKey, 'defensiveLine', value)}/><Slider label="压迫强度" value={tactics.pressing} onChange={value => updateTeamTactics(tacticsKey, 'pressing', value)}/><Slider label="转换速度" value={tactics.transitionSpeed} onChange={value => updateTeamTactics(tacticsKey, 'transitionSpeed', value)}/><label className="select-field"><span>组织方式</span><select value={tactics.buildUp} onChange={e => updateTeamTactics(tacticsKey, 'buildUp', e.target.value)}><option>短传组织</option><option>混合推进</option><option>快速直接</option></select></label><label className="select-field"><span>进攻侧重</span><select value={tactics.focus} onChange={e => updateTeamTactics(tacticsKey, 'focus', e.target.value)}><option>均衡</option><option>左路</option><option>中路</option><option>右路</option></select></label></div></section></section>
    <PlayerInspector selected={selected} updatePlayer={updatePlayer} setPage={setPage}/></div>
}

const goalkeeperAttributeLabels: Record<keyof NonNullable<PlayerTacticalProfile['goalkeeping']>, string> = {
  shotStopping: '扑救能力', handling: '手控球', aerialReach: '制空范围', oneOnOnes: '一对一', rushingOut: '出击倾向', distribution: '出球能力'
}

function PlayerInspector({ selected, updatePlayer, setPage }: { selected: PlayerTacticalProfile; updatePlayer: (changes: Partial<PlayerTacticalProfile>) => void; setPage: (page: Page) => void }) {
  const preset = getPlayerInstructionPreset(selected)
  const roleOptions = Array.from(new Set([selected.role, selected.position, ...preset.roles]))
  const isGoalkeeper = preset.group === 'goalkeeper'
  const goalkeeping = getGoalkeepingAttributes(selected)
  const baseAttributes = (Object.entries(selected.attributes) as Array<[keyof PlayerTacticalProfile['attributes'], number]>).filter(([key]) => !isGoalkeeper || ['passing', 'firstTouch', 'pace', 'stamina', 'decisions', 'vision'].includes(key))
  const confidence = selected.confidence === 'observed' ? '观测' : selected.confidence === 'modelled-high' ? '模型·高' : '模型·低'

  const updateGoalkeeping = (key: keyof NonNullable<PlayerTacticalProfile['goalkeeping']>, value: number) => {
    updatePlayer({ goalkeeping: { ...goalkeeping, [key]: value } })
  }

  return <aside className="inspector" role="region" aria-label={`球员设置：${selected.name}`} data-testid="player-inspector" data-selected-player-id={selected.playerId}>
    <div className="inspector__head"><span className={`mini-shirt mini-shirt--${selected.side}`}>{selected.shirtNumber}</span><div><h3>{selected.name}</h3><p>{selected.position}</p></div><span className="confidence-mini">{confidence}</span></div>
    <div className="inspector__body">
      <div className={`position-guidance position-guidance--${preset.group}`}><b>{preset.label}</b><p>{preset.description}</p></div>
      <label className="select-field"><span>战术角色</span><select value={selected.role} onChange={event => updatePlayer({ role: event.target.value })}>{roleOptions.map(role => <option key={role}>{role}</option>)}</select></label>
      <label className="select-field"><span>职责</span><select value={selected.duty} onChange={event => updatePlayer({ duty: event.target.value as PlayerTacticalProfile['duty'] })}>{preset.duties.map(duty => <option key={duty}>{duty}</option>)}</select></label>
      <label className="select-field"><span>跑位模式</span><select value={selected.runPattern} onChange={event => updatePlayer({ runPattern: event.target.value as PlayerTacticalProfile['runPattern'] })}>{preset.runPatterns.map(pattern => <option key={pattern}>{pattern}</option>)}</select></label>
      {isGoalkeeper ? <>
        <div className="inspector__divider">门将出球</div>
        <Slider label="出球风险" value={selected.passRisk} onChange={value => updatePlayer({ passRisk: value })}/><Slider label="短传组织" value={selected.passForward} onChange={value => updatePlayer({ passForward: value })}/><Slider label="开球距离" value={selected.passDirectness} onChange={value => updatePlayer({ passDirectness: value })}/>
        <div className="inspector__divider">门将专项</div>
        {(Object.entries(goalkeeping) as Array<[keyof NonNullable<PlayerTacticalProfile['goalkeeping']>, number]>).map(([key, value]) => <Slider key={key} label={goalkeeperAttributeLabels[key]} value={value} onChange={next => updateGoalkeeping(key, next)}/>)}
      </> : <>
        <div className="inspector__divider">持球倾向</div>
        <Slider label="传球冒险" value={selected.passRisk} onChange={value => updatePlayer({ passRisk: value })}/><Slider label="向前传球" value={selected.passForward} onChange={value => updatePlayer({ passForward: value })}/><Slider label="传球距离" value={selected.passDirectness} onChange={value => updatePlayer({ passDirectness: value })}/><Slider label="带球倾向" value={selected.carryTendency} onChange={value => updatePlayer({ carryTendency: value })}/><Slider label="射门倾向" value={selected.shootTendency} onChange={value => updatePlayer({ shootTendency: value })}/>
        <div className="inspector__divider">无球与防守</div>
        <Slider label="压迫强度" value={selected.pressIntensity} onChange={value => updatePlayer({ pressIntensity: value })}/><Slider label="盯人职责" value={selected.marking} onChange={value => updatePlayer({ marking: value })}/>
      </>}
      <div className="inspector__divider">{isGoalkeeper ? '基础能力' : '技术与身体属性'}</div>
      {baseAttributes.map(([key, value]) => <Slider key={key} label={attributeLabels[key]} value={value} onChange={next => updatePlayer({ attributes: { ...selected.attributes, [key]: next } })}/>)}
    </div>
    <div className="inspector__footer"><button className="primary" onClick={() => setPage('simulation')}>进入推演实验室 →</button></div>
  </aside>
}

function SimulationLab({ scenario, setScenario, comparison, running, progress, runSimulation, cancel, replayActions, replayMode, setReplayMode, replayStep, setReplayStep, exportResult }: { scenario: TacticalScenario; setScenario: React.Dispatch<React.SetStateAction<TacticalScenario>>; comparison: SimulationComparison | null; running: boolean; progress: { value: number; phase: string }; runSimulation: () => void; cancel: () => void; replayActions: SimulationAction[]; replayMode: 'success'|'failure'; setReplayMode: (mode:'success'|'failure') => void; replayStep: number; setReplayStep: (step:number) => void; exportResult: (format:'json'|'csv'|'pdf') => void }) {
  return <div className="content-stack"><section className="simulation-command"><div><span className="eyebrow">MONTE CARLO POSSESSION ENGINE</span><h2>基准与修改方案同步推演</h2><p>固定随机种子使差异可复现；每一条轨迹均来自球员职责、空间压力、技术属性和历史先验。</p></div><div className="run-controls"><label>推演次数<select value={scenario.iterations} onChange={e => setScenario(current => ({ ...current, iterations: Number(e.target.value) }))}><option value="300">300</option><option value="1200">1,200</option><option value="5000">5,000</option><option value="10000">10,000</option></select></label><label>随机种子<input type="number" value={scenario.seed} onChange={e => setScenario(current => ({ ...current, seed: Number(e.target.value) }))}/></label>{running ? <button className="danger" onClick={cancel}>■ 取消推演</button> : <button className="run-button" onClick={runSimulation}>▶ 运行对比推演</button>}</div></section>
    {running && <div className="running-panel"><span className="spinner"/><div><strong>{progress.phase} · {Math.round(progress.value * 100)}%</strong><p>界面保持响应，可随时取消。核心引擎未调用 AI。</p></div><div className="running-progress">{Math.round(progress.value * scenario.iterations * 2).toLocaleString()} / {(scenario.iterations * 2).toLocaleString()} 回合</div><div className="running-line"><i style={{ width: `${Math.max(1, progress.value * 100)}%` }}/></div></div>}
    {!comparison && !running && <div className="empty-simulation"><div className="simulation-orbit"><span>▶</span></div><h3>准备好进行战术实验</h3><p>前往战术编辑器改变球员职责，或直接运行当前方案与基准的对比。</p><div className="scenario-facts"><span>4-3-3 双方可编辑</span><span>{scenario.iterations.toLocaleString()} 次回合</span><span>固定种子 {scenario.seed}</span></div></div>}
    {comparison && <><div className="results-head"><div><span className="eyebrow">COMPARISON RESULT</span><h2>修改后的进攻表现</h2></div><div className="button-row"><button className="secondary" onClick={() => exportResult('json')}>导出 JSON</button><button className="secondary" onClick={() => exportResult('csv')}>导出 CSV</button><button className="primary" onClick={() => exportResult('pdf')}>导出 PDF 报告</button></div></div><div className="results-grid"><MetricCard label="射门回合率" value={percent(comparison.modified.metrics.shotRate)} delta={comparison.deltas.shotRate*100}/><MetricCard label="每回合平均 xG" value={comparison.modified.metrics.averageXg.toFixed(3)} delta={comparison.deltas.averageXg*100}/><MetricCard label="禁区进入" value={comparison.modified.metrics.boxEntries.toFixed(2)} delta={comparison.deltas.boxEntries*100}/><MetricCard label="控球延续率" value={percent(comparison.modified.metrics.retentionRate)} delta={comparison.deltas.retentionRate*100}/><MetricCard label="平均推进" value={`${comparison.modified.metrics.averageProgression.toFixed(1)}m`} delta={comparison.deltas.averageProgression}/></div>
      <div className="result-layout"><section className="panel replay-panel"><div className="panel__head"><div><h3>代表性回合回放</h3><span>虚线代表传球，轨迹为模型推断</span></div><div className="segmented segmented--small"><button className={replayMode==='success'?'is-active':''} onClick={() => {setReplayMode('success');setReplayStep(0)}}>成功机会</button><button className={replayMode==='failure'?'is-active':''} onClick={() => {setReplayMode('failure');setReplayStep(0)}}>失去球权</button></div></div><Pitch home={scenario.home} away={scenario.away} actions={replayActions} step={replayStep}/><div className="replay-controls"><button onClick={() => setReplayStep(Math.max(0,replayStep-1))}>‹</button><input type="range" min="0" max={Math.max(0,replayActions.length-1)} value={Math.min(replayStep,Math.max(0,replayActions.length-1))} onChange={e => setReplayStep(Number(e.target.value))}/><button onClick={() => setReplayStep(Math.min(replayActions.length-1,replayStep+1))}>›</button><span>{replayActions.length ? replayStep+1 : 0} / {replayActions.length}</span></div>{replayActions[replayStep] && <div className="action-caption"><b>{replayActions[replayStep].kind.toUpperCase()}</b>{replayActions[replayStep].note}<span>成功概率 {percent(replayActions[replayStep].probability)}</span></div>}</section>
      <aside className="analysis-side"><section className="panel"><span className="eyebrow">ATTACKING LANES</span><h3>进攻通道</h3><Lane label="左路" value={comparison.modified.metrics.leftShare}/><Lane label="中路" value={comparison.modified.metrics.centreShare}/><Lane label="右路" value={comparison.modified.metrics.rightShare}/></section><section className="panel"><span className="eyebrow">MODEL NOTES</span><h3>数据解释</h3>{comparison.modified.qualityNotes.map(note => <p className="model-note" key={note}>◇ {note}</p>)}<div className="ci-note">95% 区间 · {comparison.modified.metrics.possessions.toLocaleString()} 个样本<br/><b>射门率 {percent(comparison.modified.confidenceInterval.shotRate[0])}–{percent(comparison.modified.confidenceInterval.shotRate[1])}</b><br/><b>控球延续 {percent(comparison.modified.confidenceInterval.retentionRate[0])}–{percent(comparison.modified.confidenceInterval.retentionRate[1])}</b></div></section></aside></div></>}
  </div>
}
function Lane({label,value}:{label:string;value:number}) { return <div className="lane"><span>{label}<b>{percent(value)}</b></span><div><i style={{width:percent(value)}}/></div></div> }

function Settings({ appInfo, summary, onBackup }: { appInfo: {version:string;databasePath:string;platform:string}; summary: DatabaseSummary; onBackup:()=>void }) {
  return <div className="settings-grid"><section className="panel settings-section"><span className="eyebrow">APPLICATION</span><h2>桌面应用</h2><dl className="settings-list"><div><dt>版本</dt><dd>{appInfo.version}</dd></div><div><dt>平台</dt><dd>{appInfo.platform}</dd></div><div><dt>数据库</dt><dd title={appInfo.databasePath}>{appInfo.databasePath}</dd></div><div><dt>本地数据</dt><dd>{summary.matches} 场比赛 · {summary.events} 个事件</dd></div></dl><button className="secondary" onClick={onBackup}>备份 SQLite 数据库</button></section><section className="panel settings-section"><span className="eyebrow">SECURITY & PRIVACY</span><h2>本地优先</h2><ul className="security-list"><li><span>✓</span><div><b>上下文隔离</b><p>渲染器无法直接访问 Node.js 或文件系统。</p></div></li><li><span>✓</span><div><b>Token 系统加密</b><p>API Token 使用 Electron safeStorage，不进入数据库、日志或 Git。</p></div></li><li><span>✓</span><div><b>离线推演</b><p>只有主动下载数据时才访问网络。</p></div></li></ul></section><section className="panel settings-section ai-disabled"><div className="ai-disabled__title"><span>AI</span><div><span className="eyebrow">EXTENSION RESERVED</span><h2>AI 分析接口</h2></div><em>未启用</em></div><p>已预留 <code>AiAnalysisProvider</code> 接口，但首版没有注册任何远程模型、不会收集密钥或发送数据。战术推演、对比和报告均不依赖 AI。</p><fieldset disabled><label>兼容端点<input placeholder="未来版本可配置"/></label><label>模型<input placeholder="未连接"/></label><button>测试连接</button></fieldset></section><section className="panel settings-section"><span className="eyebrow">DATA PROVIDERS</span><h2>数据来源说明</h2><p>StatsBomb Open Data 用于研究与真实兴趣项目。导出分析时应保留来源说明。football-data.org 只补充其订阅允许的比赛元数据。</p><div className="provider-links"><a href="https://github.com/statsbomb/open-data">StatsBomb Open Data ↗</a><a href="https://www.football-data.org/documentation/quickstart">football-data.org 文档 ↗</a><a href="https://docs.sportmonks.com/v3">Sportmonks 适配器预留 ↗</a></div></section></div>
}

export default App
