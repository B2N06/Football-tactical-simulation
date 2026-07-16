import { useEffect, useRef, useState } from 'react'
import { buildTeamTacticalAnalysis } from '../engine/teamAnalysis'
import type { CanonicalMatchBundle, StoredMatchSummary, TeamAnalysisMetrics, TeamTacticalAnalysis } from '../types'

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`
const signedPercentPoints = (value: number): string => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`
const safeTeamColor = (value: string): string => /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value) ? value : '#36e39a'

function Benchmark({ label, value, opponent, format = 'number', lowerIsBetter = false }: { label: string; value: number; opponent: number; format?: 'number' | 'percent'; lowerIsBetter?: boolean }) {
  const ceiling = Math.max(value, opponent, format === 'percent' ? 1 : 1)
  const delta = value - opponent
  const positive = lowerIsBetter ? delta <= 0 : delta >= 0
  return <div className="benchmark-row">
    <div className="benchmark-row__head"><span>{label}</span><b>{format === 'percent' ? percent(value) : value.toFixed(1)}</b><em className={positive ? 'is-positive' : 'is-negative'}>{format === 'percent' ? signedPercentPoints(delta) : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`}</em></div>
    <div className="benchmark-row__bars"><i style={{ width: `${value / ceiling * 100}%` }}/><i style={{ width: `${opponent / ceiling * 100}%` }}/></div>
    <small>本队 / 对手基准 {format === 'percent' ? percent(opponent) : opponent.toFixed(1)}</small>
  </div>
}

function TeamMetric({ label, value, opponent, note, lowerIsBetter = false }: { label: string; value: string; opponent: string; note: string; lowerIsBetter?: boolean }) {
  return <article className="team-metric"><span>{label}</span><strong>{value}</strong><small>{lowerIsBetter ? '越低越好 · ' : ''}对手 {opponent}</small><p>{note}</p></article>
}

function phaseItems(metrics: TeamAnalysisMetrics) {
  return [
    { label: '后场组织', value: metrics.buildUpShare },
    { label: '中场推进', value: metrics.middleThirdShare },
    { label: '进攻三区', value: metrics.finalThirdShare }
  ]
}

export function TeamAnalysisPage({ matches, onCreateScenario }: { matches: StoredMatchSummary[]; onCreateScenario: (matchId: string) => Promise<void> }) {
  const [matchId, setMatchId] = useState(matches[0]?.id ?? '')
  const [primary, setPrimary] = useState<CanonicalMatchBundle | null>(null)
  const [teamId, setTeamId] = useState('')
  const [analysis, setAnalysis] = useState<TeamTacticalAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  useEffect(() => {
    if (!matchId && matches[0]) setMatchId(matches[0].id)
    else if (matchId && !matches.some(match => match.id === matchId)) setMatchId(matches[0]?.id ?? '')
  }, [matches, matchId])

  const load = async (nextMatchId: string, requestedTeamId?: string) => {
    if (!nextMatchId) return
    const request = ++requestRef.current
    setLoading(true); setError('')
    try {
      const nextPrimary = await window.footballApi.getMatchBundle(nextMatchId)
      const participantIds = [nextPrimary.match.homeTeamId, nextPrimary.match.awayTeamId]
      const resolvedTeamId = requestedTeamId && participantIds.includes(requestedTeamId) ? requestedTeamId : nextPrimary.match.homeTeamId
      const bundles = await window.footballApi.getTeamMatchBundles(nextMatchId, resolvedTeamId)
      if (request !== requestRef.current) return
      setPrimary(nextPrimary); setTeamId(resolvedTeamId); setAnalysis(buildTeamTacticalAnalysis(bundles, resolvedTeamId))
    } catch (reason) {
      if (request !== requestRef.current) return
      setPrimary(null); setTeamId(''); setAnalysis(null); setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (request === requestRef.current) setLoading(false) }
  }

  useEffect(() => { if (matchId) void load(matchId) }, [matchId])

  if (!matches.length) return <div className="team-analysis-empty"><div>◇</div><h2>球队分析需要比赛数据</h2><p>先在数据中心导入至少一场包含事件数据的比赛，再建立球队长期分析档案。</p></div>

  return <div className="content-stack team-analysis" data-testid="team-analysis-page">
    <section className="team-analysis-toolbar">
      <div><span className="eyebrow">TEAM PERFORMANCE WORKSPACE</span><h2>球队战术分析中心</h2><p>用多场事件和空间数据识别稳定模式，并与实际对手表现对照。</p></div>
      <div className="team-analysis-toolbar__controls">
        <label>基准比赛<select value={matchId} onChange={event => setMatchId(event.target.value)}>{matches.map(match => <option key={match.id} value={match.id}>{match.homeTeam} vs {match.awayTeam} · {match.date}</option>)}</select></label>
        <label>分析球队<select value={teamId} disabled={!primary || loading} onChange={event => void load(matchId, event.target.value)}>{primary?.teams.filter(team => team.id === primary.match.homeTeamId || team.id === primary.match.awayTeamId).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <button className="secondary" disabled={!analysis || loading} onClick={() => void onCreateScenario(matchId)}>建立推演方案</button>
      </div>
    </section>

    {loading && <div className="team-analysis-loading"><span className="spinner"/><div><b>正在汇总球队历史比赛</b><p>计算区域、推进、传球结构和对手基准。</p></div></div>}
    {error && <div className="notice-inline notice-inline--error"><b>球队分析生成失败</b><span>{error}</span><button onClick={() => void load(matchId, teamId)}>重试</button></div>}
    {analysis && !loading && <>
      <section className="team-identity-card" aria-label={`球队分析：${analysis.teamName}`}>
        <div className="team-identity-card__mark" style={{ borderColor: safeTeamColor(analysis.teamColor) }}><span style={{ background: safeTeamColor(analysis.teamColor) }}/>{analysis.teamName.slice(0, 1)}</div>
        <div><span className="eyebrow">{analysis.provider}</span><h2>{analysis.teamName}</h2><p>{analysis.competitions.join(' / ')} · {analysis.seasons.join(' / ')} · {analysis.dateRange.from || '日期未知'} 至 {analysis.dateRange.to || '日期未知'}</p></div>
        <dl><div><dt>分析场次</dt><dd>{analysis.matchesAnalyzed}</dd></div><div><dt>战绩</dt><dd>{analysis.record.scoredMatches ? `${analysis.record.wins}胜 ${analysis.record.draws}平 ${analysis.record.losses}负` : '比分缺失'}</dd></div><div><dt>进失球</dt><dd>{analysis.record.scoredMatches ? `${analysis.record.goalsFor} / ${analysis.record.goalsAgainst}` : '—'}</dd></div><div><dt>数据质量</dt><dd className={`quality-level quality-level--${analysis.dataQuality.level}`}>{analysis.dataQuality.level}</dd></div></dl>
      </section>

      <section className="team-metric-grid">
        <TeamMetric label="传球成功率" value={percent(analysis.metrics.passSuccess)} opponent={percent(analysis.opponentMetrics.passSuccess)} note="衡量整体连接稳定性"/>
        <TeamMetric label="每场推进动作" value={analysis.metrics.progressiveActionsPerMatch.toFixed(1)} opponent={analysis.opponentMetrics.progressiveActionsPerMatch.toFixed(1)} note="向前 10 米或进入进攻三区"/>
        <TeamMetric label="进攻三区进入" value={analysis.metrics.finalThirdEntriesPerMatch.toFixed(1)} opponent={analysis.opponentMetrics.finalThirdEntriesPerMatch.toFixed(1)} note="传球与带球跨入前场"/>
        <TeamMetric label="每场禁区进入" value={analysis.metrics.boxEntriesPerMatch.toFixed(1)} opponent={analysis.opponentMetrics.boxEntriesPerMatch.toFixed(1)} note="从禁区外进入禁区"/>
        <TeamMetric label="场地倾斜" value={percent(analysis.metrics.fieldTilt)} opponent={percent(analysis.opponentMetrics.fieldTilt)} note="双方进攻三区事件的相对占比"/>
        <TeamMetric label="每场球权损失" value={analysis.metrics.turnoversPerMatch.toFixed(1)} opponent={analysis.opponentMetrics.turnoversPerMatch.toFixed(1)} note="失败传带与明确丢失事件" lowerIsBetter/>
      </section>

      <div className="team-analysis-columns">
        <section className="panel team-benchmark"><div className="panel__head"><div><span className="eyebrow">OPPONENT BENCHMARK</span><h3>与实际对手基准比较</h3></div><span>{analysis.matchesAnalyzed} 场汇总</span></div>
          <Benchmark label="事件占比" value={analysis.metrics.eventShare} opponent={analysis.opponentMetrics.eventShare} format="percent"/>
          <Benchmark label="传球成功率" value={analysis.metrics.passSuccess} opponent={analysis.opponentMetrics.passSuccess} format="percent"/>
          <Benchmark label="推进动作 / 场" value={analysis.metrics.progressiveActionsPerMatch} opponent={analysis.opponentMetrics.progressiveActionsPerMatch}/>
          <Benchmark label="防守动作 / 场" value={analysis.metrics.defensiveActionsPerMatch} opponent={analysis.opponentMetrics.defensiveActionsPerMatch}/>
          <Benchmark label="球权损失 / 场" value={analysis.metrics.turnoversPerMatch} opponent={analysis.opponentMetrics.turnoversPerMatch} lowerIsBetter/>
        </section>
        <section className="panel phase-profile"><div className="panel__head"><div><span className="eyebrow">POSSESSION PHASES</span><h3>有球阶段分布</h3></div><span>事件位置口径</span></div>{phaseItems(analysis.metrics).map(item => <div className="phase-row" key={item.label}><span>{item.label}<b>{percent(item.value)}</b></span><div><i style={{ width: percent(item.value) }}/></div></div>)}<div className="lane-split"><span><i style={{ height: percent(analysis.metrics.leftShare) }}/><b>左 {percent(analysis.metrics.leftShare)}</b></span><span><i style={{ height: percent(analysis.metrics.centreShare) }}/><b>中 {percent(analysis.metrics.centreShare)}</b></span><span><i style={{ height: percent(analysis.metrics.rightShare) }}/><b>右 {percent(analysis.metrics.rightShare)}</b></span></div></section>
      </div>

      <div className="team-analysis-columns team-analysis-columns--wide">
        <section className="panel"><div className="panel__head"><div><span className="eyebrow">TACTICAL TERRITORY</span><h3>12 区域行动占比</h3></div><span>统一为从左向右进攻</span></div><div className="zone-grid">{analysis.zones.map(zone => <article key={zone.id} className={zone.delta >= 0 ? 'is-positive' : 'is-negative'} style={{ opacity: .55 + Math.min(.45, zone.actionShare * 3) }} title={`${zone.label}：本队 ${percent(zone.actionShare)}，对手 ${percent(zone.opponentShare)}`}><span>{zone.label}</span><b>{percent(zone.actionShare)}</b><small>{signedPercentPoints(zone.delta)}</small></article>)}</div><p className="panel-footnote">色块为本队行动占比；差值与对手在相同进攻视角下的区域占比比较。</p></section>
        <section className="panel"><div className="panel__head"><div><span className="eyebrow">COACHING REVIEW</span><h3>证据驱动的复盘重点</h3></div><span>规则引擎 · 非 AI</span></div><div className="insight-list">{analysis.insights.length ? analysis.insights.map(insight => <article className={`insight insight--${insight.kind}`} key={`${insight.kind}-${insight.title}`}><span>{insight.kind === 'strength' ? '优势' : insight.kind === 'risk' ? '风险' : '观察'}</span><div><h4>{insight.title}</h4><p>{insight.evidence}</p><small>{insight.action}</small></div></article>) : <p className="quality-note">当前数据未形成明显差异，建议增加比赛样本后继续观察。</p>}</div></section>
      </div>

      <section className="panel team-trends"><div className="panel__head"><div><span className="eyebrow">MATCH-BY-MATCH</span><h3>逐场趋势</h3></div><span>按比赛日期排序</span></div><div className="trend-table"><div className="trend-row trend-row--head"><span>比赛</span><span>传球</span><span>推进</span><span>前场进入</span><span>射门</span><span>球权损失</span></div>{analysis.trends.map(trend => <div className="trend-row" key={trend.matchId}><span><b>{trend.result ?? '—'} {trend.score ?? ''}</b>{trend.date} · {trend.venue} vs {trend.opponentName}</span><span>{percent(trend.metrics.passSuccess)}</span><span>{trend.metrics.progressiveActionsPerMatch.toFixed(0)}</span><span>{trend.metrics.finalThirdEntriesPerMatch.toFixed(0)}</span><span>{trend.metrics.shotsPerMatch.toFixed(0)}</span><span>{trend.metrics.turnoversPerMatch.toFixed(0)}</span></div>)}</div></section>

      <div className="team-analysis-columns team-analysis-columns--squad">
        <section className="panel squad-contribution"><div className="panel__head"><div><span className="eyebrow">SQUAD IMPACT</span><h3>球员战术贡献</h3></div><span>参与指数为队内相对值</span></div><div className="squad-table"><div className="squad-row squad-row--head"><span>球员</span><span>参与</span><span>传球</span><span>推进</span><span>防守</span><span>指数</span></div>{analysis.players.slice(0, 16).map(player => <div className="squad-row" key={player.playerId}><span><i>{player.shirtNumber}</i><b>{player.name}</b><small>{player.position} · {player.matches} 场</small></span><span>{percent(player.involvementShare)}</span><span>{player.passes}<small>{percent(player.passSuccess)}</small></span><span>{player.progressiveActions}</span><span>{player.defensiveActions}</span><span><em style={{ width: `${player.influenceIndex}%` }}/><b>{player.influenceIndex}</b></span></div>)}</div></section>
        <aside className="analysis-side"><section className="panel"><span className="eyebrow">FORMATION USAGE</span><h3>阵型使用</h3>{analysis.formationUsage.map(item => <div className="formation-row" key={item.formation}><b>{item.formation}</b><span>{item.count} 场 · {percent(item.share)}</span></div>)}</section><section className="panel"><span className="eyebrow">PASSING CONNECTIONS</span><h3>高频传球连接</h3>{analysis.passNetwork.slice(0, 8).map(edge => <div className="network-row" key={`${edge.fromId}-${edge.toId}`}><span>{edge.fromName} → {edge.toName}</span><b>{edge.count} 次</b><small>{percent(edge.successRate)}</small></div>)}{!analysis.passNetwork.length && <p className="quality-note">缺少接球人字段，无法生成传球连接。</p>}</section></aside>
      </div>

      <section className="panel data-quality-panel"><div><span className="eyebrow">DATA RELIABILITY</span><h3>分析可信度</h3><p>结论只使用导入数据与确定性规则，不调用 AI。</p></div><div className="quality-metrics"><span>比分覆盖<b>{percent(analysis.dataQuality.scoreCoverage)}</b></span><span>xG 覆盖<b>{percent(analysis.dataQuality.xgCoverage)}</b></span><span>球员归属<b>{percent(analysis.dataQuality.playerAttribution)}</b></span><span>追踪覆盖<b>{percent(analysis.dataQuality.trackingCoverage)}</b></span></div><ul>{analysis.dataQuality.notes.map(note => <li key={note}>{note}</li>)}</ul></section>
    </>}
  </div>
}
