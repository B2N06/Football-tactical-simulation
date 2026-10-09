import { useEffect, useMemo, useState } from 'react'
import { Pitch } from './Pitch'
import { createScenarioFromBundles } from '../engine/history'
import type { CanonicalMatchBundle, MatchEvent, StoredMatchSummary } from '../types'

const labels: Record<MatchEvent['kind'], string> = { pass: '传球', carry: '持球推进', shot: '射门', duel: '对抗', pressure: '压迫', turnover: '丢失球权', recovery: '夺回球权' }

export function MatchAnalysisPage({ matches }: { matches: StoredMatchSummary[] }) {
  const [selectedId, setSelectedId] = useState(matches[0]?.id ?? '')
  const [bundle, setBundle] = useState<CanonicalMatchBundle | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!matches.some(match => match.id === selectedId)) setSelectedId(matches[0]?.id ?? '')
  }, [matches, selectedId])
  useEffect(() => {
    let active = true
    if (!selectedId) { setBundle(null); setLoading(false); setError(''); return }
    setLoading(true); setError(''); setBundle(null)
    void window.footballApi.getMatchBundle(selectedId).then(value => {
      if (active) { setBundle(value); setFrameIndex(0) }
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedId])
  const positions = useMemo(() => {
    if (!bundle || !bundle.players.length) return null
    try {
      const scenario = createScenarioFromBundles([bundle])
      const frame = bundle.frames[frameIndex]
      const rosterIds = new Set([...scenario.home, ...scenario.away].map(player => player.playerId))
      const observed = new Map(frame?.confidence === 'observed' ? frame.players.filter(player => player.playerId && rosterIds.has(player.playerId)).map(player => [player.playerId!, player.position]) : [])
      const apply = (players: typeof scenario.home) => players.map(player => ({ ...player, anchor: observed.get(player.playerId) ?? player.anchor }))
      return { home: apply(scenario.home), away: apply(scenario.away), observedCount: observed.size }
    } catch { return null }
  }, [bundle, frameIndex])
  const names = useMemo(() => new Map(bundle?.players.map(player => [player.id, player.name])), [bundle])
  const shots = bundle?.events.filter(event => event.kind === 'shot') ?? []
  const passes = bundle?.events.filter(event => event.kind === 'pass') ?? []
  const attributed = bundle?.events.filter(event => event.playerId).length ?? 0
  const xgShots = shots.filter(event => event.xg !== undefined)
  const frame = bundle?.frames[frameIndex]

  return <div className="content-stack">
    <div className="section-intro"><div><span className="eyebrow">MATCH / OBSERVED DATA</span><h2>从真实事件，读懂比赛。</h2><p>数据覆盖按文件实际内容展示。空间快照与推断站位分开说明。</p></div><label className="select-field">分析比赛<select aria-label="分析比赛" value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={!matches.length}>{matches.length ? matches.map(match => <option key={match.id} value={match.id}>{match.homeTeam} vs {match.awayTeam}</option>) : <option value="">先导入比赛数据</option>}</select></label></div>
    {!matches.length && <section className="panel empty-state"><b>还没有可分析的比赛</b><p>在数据中心载入示例或导入比赛，再回到这里查看事件与空间数据。</p></section>}
    {loading && <section className="page-loading" role="status"><span className="spinner"/>正在读取所选比赛</section>}
    {error && <section className="notice-inline notice-inline--error" role="alert">{error}</section>}
    {bundle && !loading && <>
      <div className="analysis-layout"><section className="panel pitch-panel"><div className="panel__head"><div><h3>{bundle.teams.find(team => team.id === bundle.match.homeTeamId)?.name} vs {bundle.teams.find(team => team.id === bundle.match.awayTeamId)?.name}</h3><span>{bundle.match.competition} · {bundle.match.date || '日期未知'}</span></div><span className="status-tag">{positions?.observedCount ? `${positions.observedCount} 人有观测坐标` : '站位由模型推断'}</span></div>{positions ? <Pitch home={positions.home} away={positions.away}/> : <div className="empty-state">文件未提供足够阵容，无法生成球员站位。</div>}{bundle.frames.length > 0 && <label className="slider-field" style={{ marginTop: 18 }}><span>空间帧 {frameIndex + 1} / {bundle.frames.length}<b>{frame?.second.toFixed(1)} 秒</b></span><input aria-label="空间帧" type="range" min="0" max={bundle.frames.length - 1} value={frameIndex} onChange={event => setFrameIndex(Number(event.target.value))}/></label>}<p className="panel-footnote">{positions?.observedCount ? '有身份标识的球员采用所选帧坐标；其余球员以事件校准站位补齐。' : '无可绑定球员的观测坐标，展示基于阵容和历史事件生成的推断站位。'} 快照不等于完整逐帧追踪。</p></section>
      <aside className="analysis-side"><section className="panel"><span className="eyebrow">COVERAGE / COUNTS</span><h3>实际数据覆盖</h3><dl className="settings-list"><div><dt>比赛事件</dt><dd>{bundle.events.length.toLocaleString()}</dd></div><div><dt>空间帧</dt><dd>{bundle.frames.length.toLocaleString()}</dd></div><div><dt>球员档案</dt><dd>{bundle.players.length}</dd></div><div><dt>球员归属</dt><dd>{attributed} / {bundle.events.length} 事件</dd></div><div><dt>xG 覆盖</dt><dd>{xgShots.length} / {shots.length} 射门</dd></div></dl><p>{bundle.source.attribution ?? bundle.source.provider}</p></section><section className="panel"><span className="eyebrow">MATCH / ACTIONS</span><h3>事件摘要</h3><dl className="settings-list"><div><dt>传球</dt><dd>{passes.length}</dd></div><div><dt>射门</dt><dd>{shots.length}</dd></div><div><dt>已知 xG 总计</dt><dd>{xgShots.length ? xgShots.reduce((sum, event) => sum + (event.xg ?? 0), 0).toFixed(2) : '未提供'}</dd></div></dl><p className="panel-footnote">只汇总已导入事件；未知结果和缺失 xG 均不当作零表现。</p></section></aside></div>
      <section className="panel"><span className="eyebrow">EVENT / TIMELINE</span><h3>比赛事件时间线</h3><p>展示最早的 200 个事件，位置以 105 × 68 米统一坐标记录。</p><div className="event-list">{bundle.events.slice().sort((a,b) => a.second - b.second).slice(0,200).map(event => <div key={event.id}><time>{Math.floor(event.second / 60)}:{String(Math.floor(event.second % 60)).padStart(2,'0')}</time><b>{labels[event.kind]}</b><span>{names.get(event.playerId ?? '') ?? '球员未标识'} · {event.outcome === 'success' ? '成功' : event.outcome === 'failure' ? '失败' : '结果未标识'} · ({event.start.x.toFixed(1)}, {event.start.y.toFixed(1)})</span></div>)}</div></section>
    </>}
  </div>
}
