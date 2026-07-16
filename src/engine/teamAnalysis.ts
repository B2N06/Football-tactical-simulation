import type {
  CanonicalMatchBundle, MatchEvent, TeamAnalysisInsight, TeamAnalysisMetrics, TeamMatchTrend,
  TeamPlayerContribution, TeamTacticalAnalysis, TeamZoneAnalysis, Vec2
} from '../types'
import { distance } from './coordinates'
import { getTacticalPositionGroup } from './playerInstructions'

const FINAL_THIRD_X = 70
const BOX_X = 88.5
const BOX_Y_MIN = 13.84
const BOX_Y_MAX = 54.16

const ratio = (value: number, total: number): number => total > 0 ? value / total : 0
const perMatch = (value: number, matches: number): number => matches > 0 ? value / matches : 0
const rounded = (value: number, digits = 4): number => Number(value.toFixed(digits))

function opponentTeamId(bundle: CanonicalMatchBundle, teamId: string): string {
  if (bundle.match.homeTeamId === teamId) return bundle.match.awayTeamId
  if (bundle.match.awayTeamId === teamId) return bundle.match.homeTeamId
  throw new Error(`球队 ${teamId} 未参加比赛 ${bundle.match.id}`)
}

// CanonicalMatchBundle guarantees that every acting team attacks from left to right.
// Home/away and period must therefore never be used to flip canonical event data again.
function attackingPoint(point: Vec2): Vec2 { return point }

function isOnBall(event: MatchEvent): boolean {
  return event.kind === 'pass' || event.kind === 'carry' || event.kind === 'shot'
}

function isDefensive(event: MatchEvent): boolean {
  return event.kind === 'pressure' || event.kind === 'duel' || event.kind === 'recovery'
}

function isTurnover(event: MatchEvent): boolean {
  return event.kind === 'turnover' || ((event.kind === 'pass' || event.kind === 'carry') && event.outcome === 'failure')
}

function isProgressive(event: MatchEvent): boolean {
  if (!event.end || event.outcome === 'failure' || (event.kind !== 'pass' && event.kind !== 'carry')) return false
  const start = attackingPoint(event.start), end = attackingPoint(event.end)
  return end.x - start.x >= 10 || (start.x < FINAL_THIRD_X && end.x >= FINAL_THIRD_X)
}

function isFinalThirdEntry(event: MatchEvent): boolean {
  if (!event.end || event.outcome === 'failure' || (event.kind !== 'pass' && event.kind !== 'carry')) return false
  const start = attackingPoint(event.start), end = attackingPoint(event.end)
  return start.x < FINAL_THIRD_X && end.x >= FINAL_THIRD_X
}

function isBoxEntry(event: MatchEvent): boolean {
  if (!event.end || event.outcome === 'failure' || (event.kind !== 'pass' && event.kind !== 'carry')) return false
  const start = attackingPoint(event.start), end = attackingPoint(event.end)
  const startInBox = start.x >= BOX_X && start.y >= BOX_Y_MIN && start.y <= BOX_Y_MAX
  const endInBox = end.x >= BOX_X && end.y >= BOX_Y_MIN && end.y <= BOX_Y_MAX
  return !startInBox && endInBox
}

function metricSet(bundles: CanonicalMatchBundle[], resolveTeam: (bundle: CanonicalMatchBundle) => string): TeamAnalysisMetrics {
  let entityEvents = 0, allEvents = 0, passes = 0, successfulPasses = 0, forwardPasses = 0
  let progressiveActions = 0, finalThirdEntries = 0, boxEntries = 0, shots = 0, knownXgShots = 0, xg = 0
  let turnovers = 0, defensiveActions = 0, highRegains = 0, entityFinalThirdActions = 0, opponentFinalThirdActions = 0
  let opponentBuildUpPasses = 0, entityPressuresInBuildUp = 0
  const phaseCounts = [0, 0, 0], laneCounts = [0, 0, 0]

  for (const bundle of bundles) {
    const teamId = resolveTeam(bundle), opponentId = opponentTeamId(bundle, teamId)
    const own = bundle.events.filter(event => event.teamId === teamId)
    const opponent = bundle.events.filter(event => event.teamId === opponentId)
    entityEvents += own.length
    allEvents += own.length + opponent.length

    for (const event of own) {
      const start = attackingPoint(event.start)
      if (event.kind === 'pass') {
        passes += 1
        if (event.outcome !== 'failure') successfulPasses += 1
        if (event.end && attackingPoint(event.end).x - start.x > 2) forwardPasses += 1
      }
      if (isProgressive(event)) progressiveActions += 1
      if (isFinalThirdEntry(event)) finalThirdEntries += 1
      if (isBoxEntry(event)) boxEntries += 1
      if (event.kind === 'shot') {
        shots += 1
        if (typeof event.xg === 'number') { knownXgShots += 1; xg += event.xg }
      }
      if (isTurnover(event)) turnovers += 1
      if (isDefensive(event)) {
        defensiveActions += 1
        if (event.kind === 'recovery' && start.x >= FINAL_THIRD_X) highRegains += 1
        if ((event.kind === 'pressure' || event.kind === 'duel') && start.x >= 63) entityPressuresInBuildUp += 1
      }
      if (isOnBall(event)) {
        if (start.x < 35) phaseCounts[0] += 1
        else if (start.x < FINAL_THIRD_X) phaseCounts[1] += 1
        else { phaseCounts[2] += 1; entityFinalThirdActions += 1 }
        if (start.y < 68 / 3) laneCounts[0] += 1
        else if (start.y <= 68 * 2 / 3) laneCounts[1] += 1
        else laneCounts[2] += 1
      }
    }

    for (const event of opponent) {
      const opponentPoint = attackingPoint(event.start)
      if (isOnBall(event) && opponentPoint.x >= FINAL_THIRD_X) opponentFinalThirdActions += 1
      if (event.kind === 'pass' && opponentPoint.x <= 42) opponentBuildUpPasses += 1
    }
  }

  const matches = bundles.length
  const phaseTotal = phaseCounts.reduce((sum, value) => sum + value, 0)
  const laneTotal = laneCounts.reduce((sum, value) => sum + value, 0)
  return {
    eventShare: rounded(ratio(entityEvents, allEvents)),
    passSuccess: rounded(ratio(successfulPasses, passes)),
    forwardPassShare: rounded(ratio(forwardPasses, passes)),
    progressiveActionsPerMatch: rounded(perMatch(progressiveActions, matches), 2),
    finalThirdEntriesPerMatch: rounded(perMatch(finalThirdEntries, matches), 2),
    boxEntriesPerMatch: rounded(perMatch(boxEntries, matches), 2),
    shotsPerMatch: rounded(perMatch(shots, matches), 2),
    xgPerMatch: knownXgShots ? rounded(perMatch(xg, matches), 3) : null,
    xgPerShot: knownXgShots ? rounded(xg / knownXgShots, 3) : null,
    turnoversPerMatch: rounded(perMatch(turnovers, matches), 2),
    defensiveActionsPerMatch: rounded(perMatch(defensiveActions, matches), 2),
    highRegainsPerMatch: rounded(perMatch(highRegains, matches), 2),
    fieldTilt: rounded(ratio(entityFinalThirdActions, entityFinalThirdActions + opponentFinalThirdActions)),
    ppdaApprox: entityPressuresInBuildUp ? rounded(opponentBuildUpPasses / entityPressuresInBuildUp, 2) : null,
    buildUpShare: rounded(ratio(phaseCounts[0], phaseTotal)),
    middleThirdShare: rounded(ratio(phaseCounts[1], phaseTotal)),
    finalThirdShare: rounded(ratio(phaseCounts[2], phaseTotal)),
    leftShare: rounded(ratio(laneCounts[0], laneTotal)),
    centreShare: rounded(ratio(laneCounts[1], laneTotal)),
    rightShare: rounded(ratio(laneCounts[2], laneTotal))
  }
}

function inferFormation(bundle: CanonicalMatchBundle, teamId: string): string {
  const playersById = new Map(bundle.players.map(player => [player.id, player]))
  const starters = bundle.lineups.filter(entry => entry.teamId === teamId && entry.starter).map(entry => playersById.get(entry.playerId)).filter(Boolean)
  let defenders = 0, midfielders = 0, forwards = 0, unknown = 0
  for (const player of starters) {
    const group = getTacticalPositionGroup({ position: player!.position, role: player!.position })
    if (group === 'centralDefender' || group === 'fullBack') defenders += 1
    else if (group === 'defensiveMidfield' || group === 'centralMidfield' || group === 'attackingMidfield') midfielders += 1
    else if (group === 'winger' || group === 'striker') forwards += 1
    else if (group !== 'goalkeeper') unknown += 1
  }
  return unknown || defenders + midfielders + forwards !== 10 ? '阵型待确认' : `${defenders}-${midfielders}-${forwards}`
}

function playerContributions(bundles: CanonicalMatchBundle[], teamId: string): TeamPlayerContribution[] {
  const records = new Map<string, Omit<TeamPlayerContribution, 'passSuccess' | 'involvementShare' | 'influenceIndex'> & { successfulPasses: number; knownXgShots: number }>()
  let teamEventTotal = 0
  for (const bundle of bundles) {
    const attributedPlayerIds = new Set(bundle.events.filter(event => event.teamId === teamId && event.playerId).map(event => event.playerId!))
    const squadPlayerIds = new Set(bundle.lineups.filter(entry => entry.teamId === teamId).map(entry => entry.playerId))
    for (const player of bundle.players.filter(item => item.teamId === teamId)) {
      const current = records.get(player.id)
      const appeared = squadPlayerIds.has(player.id) || attributedPlayerIds.has(player.id)
      if (current) current.matches += appeared ? 1 : 0
      else records.set(player.id, { playerId: player.id, name: player.name, position: player.position, shirtNumber: player.shirtNumber, matches: appeared ? 1 : 0, events: 0, passes: 0, successfulPasses: 0, progressiveActions: 0, carries: 0, shots: 0, xg: null, knownXgShots: 0, defensiveActions: 0, turnovers: 0 })
    }
    for (const event of bundle.events.filter(item => item.teamId === teamId && item.playerId)) {
      const record = records.get(event.playerId!)
      if (!record) continue
      teamEventTotal += 1; record.events += 1
      if (event.kind === 'pass') { record.passes += 1; if (event.outcome !== 'failure') record.successfulPasses += 1 }
      if (isProgressive(event)) record.progressiveActions += 1
      if (event.kind === 'carry') record.carries += 1
      if (event.kind === 'shot') { record.shots += 1; if (typeof event.xg === 'number') { record.knownXgShots += 1; record.xg = (record.xg ?? 0) + event.xg } }
      if (isDefensive(event)) record.defensiveActions += 1
      if (isTurnover(event)) record.turnovers += 1
    }
  }
  const activeRecords = [...records.values()].filter(record => record.matches > 0 || record.events > 0)
  const rawScores = activeRecords.map(record => record.events + record.progressiveActions * 1.4 + record.carries * .5 + record.shots * 1.5 + (record.xg ?? 0) * 8 + record.defensiveActions * .8 - record.turnovers * .4)
  const maxScore = Math.max(1, ...rawScores)
  return activeRecords.map((record, index) => ({
    playerId: record.playerId, name: record.name, position: record.position, shirtNumber: record.shirtNumber,
    matches: record.matches, events: record.events, passes: record.passes, passSuccess: rounded(ratio(record.successfulPasses, record.passes)),
    progressiveActions: record.progressiveActions, carries: record.carries, shots: record.shots, xg: record.knownXgShots ? rounded(record.xg ?? 0, 3) : null,
    defensiveActions: record.defensiveActions, turnovers: record.turnovers, involvementShare: rounded(ratio(record.events, teamEventTotal)),
    influenceIndex: Math.max(0, Math.round(rawScores[index] / maxScore * 100))
  })).sort((a, b) => b.influenceIndex - a.influenceIndex || b.events - a.events)
}

function zoneAnalysis(bundles: CanonicalMatchBundle[], teamId: string): TeamZoneAnalysis[] {
  const own = Array(12).fill(0) as number[], opposition = Array(12).fill(0) as number[]
  const zoneIndex = (point: Vec2): number => Math.min(3, Math.floor(point.x / (105 / 4))) + Math.min(2, Math.floor(point.y / (68 / 3))) * 4
  for (const bundle of bundles) {
    const opponentId = opponentTeamId(bundle, teamId)
    for (const event of bundle.events) {
      if (!isOnBall(event)) continue
      if (event.teamId === teamId) own[zoneIndex(attackingPoint(event.start))] += 1
      else if (event.teamId === opponentId) opposition[zoneIndex(attackingPoint(event.start))] += 1
    }
  }
  const ownTotal = own.reduce((sum, value) => sum + value, 0), opponentTotal = opposition.reduce((sum, value) => sum + value, 0)
  const columns = ['后场', '中后场', '中前场', '进攻三区'], rows = ['左侧', '中路', '右侧']
  return own.map((value, index) => {
    const column = index % 4, row = Math.floor(index / 4)
    const actionShare = rounded(ratio(value, ownTotal)), opponentShare = rounded(ratio(opposition[index], opponentTotal))
    return { id: `zone-${column}-${row}`, label: `${columns[column]}·${rows[row]}`, column, row, actionShare, opponentShare, delta: rounded(actionShare - opponentShare) }
  })
}

function passNetwork(bundles: CanonicalMatchBundle[], teamId: string): TeamTacticalAnalysis['passNetwork'] {
  const players = new Map<string, string>(), edges = new Map<string, { fromId: string; toId: string; count: number; successes: number }>()
  for (const bundle of bundles) {
    bundle.players.filter(player => player.teamId === teamId).forEach(player => players.set(player.id, player.name))
    for (const event of bundle.events.filter(item => item.teamId === teamId && item.kind === 'pass' && item.playerId && item.recipientId)) {
      const key = `${event.playerId}\u0000${event.recipientId}`
      const edge = edges.get(key) ?? { fromId: event.playerId!, toId: event.recipientId!, count: 0, successes: 0 }
      edge.count += 1; if (event.outcome !== 'failure') edge.successes += 1; edges.set(key, edge)
    }
  }
  return [...edges.values()].map(edge => ({ fromId: edge.fromId, fromName: players.get(edge.fromId) ?? edge.fromId, toId: edge.toId, toName: players.get(edge.toId) ?? edge.toId, count: edge.count, successRate: rounded(ratio(edge.successes, edge.count)) }))
    .sort((a, b) => b.count - a.count || b.successRate - a.successRate).slice(0, 20)
}

function buildInsights(metrics: TeamAnalysisMetrics, opponent: TeamAnalysisMetrics): TeamAnalysisInsight[] {
  const insights: TeamAnalysisInsight[] = []
  const add = (kind: TeamAnalysisInsight['kind'], title: string, evidence: string, action: string) => insights.push({ kind, title, evidence, action })
  if (metrics.passSuccess >= opponent.passSuccess + .04) add('strength', '传控稳定性优于对手', `传球成功率高出对手 ${Math.round((metrics.passSuccess - opponent.passSuccess) * 100)} 个百分点。`, '保留当前第一、第二出球点，并重点复盘成功破压线路。')
  else if (metrics.passSuccess + .04 < opponent.passSuccess) add('risk', '传球稳定性落后', `传球成功率低于对手 ${Math.round((opponent.passSuccess - metrics.passSuccess) * 100)} 个百分点。`, '按后场、中场和进攻三区拆分失误，优先训练高频丢球区域的接应角度。')
  else add('watch', '传球稳定性接近对手', `双方传球成功率差值为 ${Math.abs((metrics.passSuccess - opponent.passSuccess) * 100).toFixed(1)} 个百分点。`, '结合推进次数判断控球是否真正转化为向前收益。')

  if (metrics.progressiveActionsPerMatch > opponent.progressiveActionsPerMatch * 1.15) add('strength', '纵向推进占优', `每场推进动作 ${metrics.progressiveActionsPerMatch} 次，对手为 ${opponent.progressiveActionsPerMatch} 次。`, '识别贡献最高的推进球员与传球组合，形成可重复的出球模板。')
  else if (metrics.progressiveActionsPerMatch * 1.15 < opponent.progressiveActionsPerMatch) add('risk', '向前推进不足', `每场推进动作 ${metrics.progressiveActionsPerMatch} 次，对手为 ${opponent.progressiveActionsPerMatch} 次。`, '增加中线附近第三人接应与弱侧转移，减少无收益横传。')

  if (metrics.fieldTilt >= .56) add('strength', '比赛重心稳定压向前场', `进攻三区事件倾斜达到 ${Math.round(metrics.fieldTilt * 100)}%。`, '进一步检查禁区进入和射门质量，避免只有压制没有终结。')
  else if (metrics.fieldTilt <= .42) add('risk', '比赛重心偏向本方半场', `进攻三区事件倾斜只有 ${Math.round(metrics.fieldTilt * 100)}%。`, '优先复盘第一脚解压传球和回收后的前两次行动。')

  const laneShares = [['左路', metrics.leftShare], ['中路', metrics.centreShare], ['右路', metrics.rightShare]] as const
  const concentrated = laneShares.find(([, share]) => share >= .5)
  if (concentrated) add('watch', `进攻明显集中在${concentrated[0]}`, `${concentrated[0]}事件占比 ${Math.round(concentrated[1] * 100)}%。`, '检查这是主动强侧策略还是弱侧接应不足，并准备对手封锁后的替代线路。')

  if (metrics.turnoversPerMatch > opponent.turnoversPerMatch * 1.2 && metrics.turnoversPerMatch - opponent.turnoversPerMatch >= 1) add('risk', '球权损失偏多', `每场球权损失 ${metrics.turnoversPerMatch} 次，对手为 ${opponent.turnoversPerMatch} 次。`, '按球员和区域查看失误来源，将高风险动作与身后保护方案同时设计。')
  return insights.slice(0, 6)
}

export function buildTeamTacticalAnalysis(input: CanonicalMatchBundle[], teamId: string): TeamTacticalAnalysis {
  const first = input[0]
  if (!first) throw new Error('至少需要一场比赛才能生成球队分析')
  const provider = first.source.provider
  const bundles = input.filter(bundle => bundle.source.provider === provider && (bundle.match.homeTeamId === teamId || bundle.match.awayTeamId === teamId))
  if (!bundles.length) throw new Error(`数据中不存在球队 ${teamId}`)
  const team = bundles.flatMap(bundle => bundle.teams).find(item => item.id === teamId)!
  const metrics = metricSet(bundles, () => teamId)
  const opponentMetrics = metricSet(bundles, bundle => opponentTeamId(bundle, teamId))
  const dates = bundles.map(bundle => bundle.match.date).filter(Boolean).sort()
  const record = { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, scoredMatches: 0 }

  const trends: TeamMatchTrend[] = bundles.map(bundle => {
    const opponentId = opponentTeamId(bundle, teamId), opponent = bundle.teams.find(item => item.id === opponentId)
    const home = bundle.match.homeTeamId === teamId
    const ownScore = home ? bundle.match.homeScore : bundle.match.awayScore
    const opponentScore = home ? bundle.match.awayScore : bundle.match.homeScore
    let result: TeamMatchTrend['result']
    if (typeof ownScore === 'number' && typeof opponentScore === 'number') {
      record.scoredMatches += 1; record.goalsFor += ownScore; record.goalsAgainst += opponentScore
      if (ownScore > opponentScore) { result = '胜'; record.wins += 1 }
      else if (ownScore < opponentScore) { result = '负'; record.losses += 1 }
      else { result = '平'; record.draws += 1 }
    }
    const venue: TeamMatchTrend['venue'] = home ? '主场' : '客场'
    return { matchId: bundle.match.id, date: bundle.match.date, opponentId, opponentName: opponent?.name ?? opponentId, venue, score: typeof ownScore === 'number' && typeof opponentScore === 'number' ? `${ownScore}-${opponentScore}` : undefined, result, metrics: metricSet([bundle], () => teamId) }
  }).sort((a, b) => a.date.localeCompare(b.date))

  const formationCounts = new Map<string, number>()
  bundles.forEach(bundle => { const formation = inferFormation(bundle, teamId); formationCounts.set(formation, (formationCounts.get(formation) ?? 0) + 1) })
  const formationUsage = [...formationCounts].map(([formation, count]) => ({ formation, count, share: rounded(count / bundles.length) })).sort((a, b) => b.count - a.count)
  const shots = bundles.flatMap(bundle => bundle.events.filter(event => event.teamId === teamId && event.kind === 'shot'))
  const allEvents = bundles.flatMap(bundle => bundle.events)
  const teamEvents = allEvents.filter(event => event.teamId === teamId)
  const scoreCoverage = rounded(record.scoredMatches / bundles.length)
  const xgCoverage = shots.length ? rounded(ratio(shots.filter(event => typeof event.xg === 'number').length, shots.length)) : 0
  const playerAttribution = rounded(ratio(teamEvents.filter(event => event.playerId).length, teamEvents.length))
  const trackingCoverage = rounded(ratio(bundles.filter(bundle => bundle.frames.length > 0).length, bundles.length))
  const qualityScore = (scoreCoverage + xgCoverage + playerAttribution + trackingCoverage) / 4
  const notes: string[] = []
  if (bundles.length < 3) notes.push('当前少于 3 场比赛，趋势只适合作为初步观察。')
  if (scoreCoverage < 1) notes.push('部分比赛缺少比分，胜平负与进失球仅统计有比分场次。')
  if (!shots.length) notes.push('当前样本没有射门事件，无法评估机会质量与 xG。')
  else if (xgCoverage < .8) notes.push('部分射门缺少 xG，机会质量指标只基于已有 xG 射门。')
  if (trackingCoverage < .5) notes.push('逐帧追踪覆盖不足，区域分析主要来自事件坐标。')
  if (playerAttribution < .8) notes.push('部分事件缺少球员归属，球员贡献榜可能低估相关球员。')

  return {
    teamId, teamName: team.name, teamColor: team.color, provider,
    competitions: [...new Set(bundles.map(bundle => bundle.match.competition))], seasons: [...new Set(bundles.map(bundle => bundle.match.season))],
    dateRange: { from: dates[0] ?? '', to: dates.at(-1) ?? '' }, matchesAnalyzed: bundles.length, record, metrics, opponentMetrics, trends, formationUsage,
    zones: zoneAnalysis(bundles, teamId), players: playerContributions(bundles, teamId), passNetwork: passNetwork(bundles, teamId), insights: buildInsights(metrics, opponentMetrics),
    dataQuality: { scoreCoverage, xgCoverage, playerAttribution, trackingCoverage, level: qualityScore >= .78 ? '高' : qualityScore >= .48 ? '中' : '低', notes }, generatedAt: new Date().toISOString()
  }
}
