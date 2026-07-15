import type { CanonicalMatchBundle, MatchEvent, Player, PlayerTacticalProfile, TacticalScenario, TeamSide, Vec2 } from '../types'
import { clamp, distance } from './coordinates'

type PositionGroup = 'gk' | 'rb' | 'cb' | 'lb' | 'dm' | 'cm' | 'am' | 'rw' | 'lw' | 'st' | 'other'

const homeSlots: Array<{ group: PositionGroup; anchor: Vec2 }> = [
  { group: 'gk', anchor: { x: 6, y: 34 } }, { group: 'rb', anchor: { x: 23, y: 58 } },
  { group: 'cb', anchor: { x: 19, y: 41 } }, { group: 'cb', anchor: { x: 19, y: 27 } },
  { group: 'lb', anchor: { x: 23, y: 10 } }, { group: 'dm', anchor: { x: 36, y: 34 } },
  { group: 'cm', anchor: { x: 49, y: 44 } }, { group: 'am', anchor: { x: 59, y: 30 } },
  { group: 'rw', anchor: { x: 64, y: 59 } }, { group: 'lw', anchor: { x: 66, y: 9 } },
  { group: 'st', anchor: { x: 77, y: 34 } }
]

const groupLabels: Record<PositionGroup, string> = {
  gk: '门将', rb: '右后卫', cb: '中后卫', lb: '左后卫', dm: '后腰', cm: '中前卫',
  am: '前腰', rw: '右边锋', lw: '左边锋', st: '中锋', other: '待配置位置'
}

function classifyPosition(position: string): PositionGroup {
  const value = position.toLowerCase().replace(/[\s_-]/g, '')
  if (/goalkeeper|keeper|门将|^gk$/.test(value)) return 'gk'
  if (/rightback|rightwingback|右后卫|右翼卫|^rb$|^rwb$/.test(value)) return 'rb'
  if (/leftback|leftwingback|左后卫|左翼卫|^lb$|^lwb$/.test(value)) return 'lb'
  if (/centreback|centerback|中后卫|^cb$/.test(value)) return 'cb'
  if (/defensivemid|holdingmid|后腰|防守中场|^dm$|^cdm$/.test(value)) return 'dm'
  if (/attackingmid|前腰|^am$|^cam$/.test(value)) return 'am'
  if (/rightwing|rightmid|右边锋|右前卫|^rw$|^rm$/.test(value)) return 'rw'
  if (/leftwing|leftmid|左边锋|左前卫|^lw$|^lm$/.test(value)) return 'lw'
  if (/striker|centreforward|centerforward|中锋|前锋|^st$|^cf$|^fw$/.test(value)) return 'st'
  if (/midfield|中场|中前卫|^cm$/.test(value)) return 'cm'
  return 'other'
}

function orderedSquad(bundle: CanonicalMatchBundle, teamId: string): Player[] {
  const byId = new Map(bundle.players.filter(player => player.teamId === teamId).map(player => [player.id, player]))
  const lineupIds = bundle.lineups.filter(entry => entry.teamId === teamId).sort((a, b) => Number(b.starter) - Number(a.starter)).map(entry => entry.playerId)
  const ordered = [...new Set([...lineupIds, ...byId.keys()])].map(id => byId.get(id)).filter((player): player is Player => Boolean(player)).slice(0, 11)
  while (ordered.length < 11) {
    const index = ordered.length + 1
    ordered.push({ id: `${teamId}-placeholder-${index}`, name: `待配置球员 ${index}`, teamId, shirtNumber: index, position: '待配置位置' })
  }
  return ordered
}

function assignSlots(players: Player[], side: TeamSide): Array<{ player: Player; group: PositionGroup; anchor: Vec2 }> {
  const remaining = players.map(player => ({ player, group: classifyPosition(player.position) }))
  return homeSlots.map(slot => {
    let index = remaining.findIndex(item => item.group === slot.group)
    if (index < 0 && ['dm', 'cm', 'am'].includes(slot.group)) index = remaining.findIndex(item => ['dm', 'cm', 'am'].includes(item.group))
    if (index < 0 && ['rw', 'lw', 'st'].includes(slot.group)) index = remaining.findIndex(item => ['rw', 'lw', 'st'].includes(item.group))
    if (index < 0) index = 0
    const selected = remaining.splice(index, 1)[0]
    const anchor = side === 'home' ? slot.anchor : { x: 105 - slot.anchor.x, y: 68 - slot.anchor.y }
    return { player: selected.player, group: selected.group === 'other' ? slot.group : selected.group, anchor }
  })
}

function smoothedRatio(successes: number, total: number, prior: number, priorWeight = 16): number {
  return (successes + prior * priorWeight) / (total + priorWeight)
}

function mean(values: number[], fallback: number): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback
}

function rounded(value: number): number { return Math.round(clamp(value, 0, 100)) }

function profileFromHistory(
  assigned: { player: Player; group: PositionGroup; anchor: Vec2 }, side: TeamSide,
  events: MatchEvent[], observedPositions: Vec2[]
): PlayerTacticalProfile {
  const passes = events.filter(event => event.kind === 'pass' && event.end)
  const carries = events.filter(event => event.kind === 'carry')
  const shots = events.filter(event => event.kind === 'shot')
  const defensiveActions = events.filter(event => ['pressure', 'duel', 'recovery'].includes(event.kind))
  const onBallActions = Math.max(1, passes.length + carries.length + shots.length)
  const passSuccess = smoothedRatio(passes.filter(event => event.outcome !== 'failure').length, passes.length, .76, 24)
  const forwardPasses = passes.filter(event => (event.end!.x - event.start.x) > 2).length
  const forwardShare = smoothedRatio(forwardPasses, passes.length, .55)
  const passDistance = mean(passes.map(event => distance(event.start, event.end!)), 16)
  const carryShare = smoothedRatio(carries.length, onBallActions, .18)
  const shotShare = smoothedRatio(shots.length, onBallActions, .08)
  const defensiveShare = smoothedRatio(defensiveActions.length, Math.max(1, events.length), .12)
  const sampleSize = events.length + observedPositions.length
  const base = ['gk', 'cb', 'rb', 'lb', 'dm'].includes(assigned.group) ? 62 : 67
  const goalkeeper = assigned.group === 'gk'
  const attacker = ['rw', 'lw', 'st', 'am'].includes(assigned.group)
  const defender = ['cb', 'rb', 'lb', 'dm'].includes(assigned.group)
  const anchor = observedPositions.length >= 5 ? {
    x: clamp(mean(observedPositions.map(point => point.x), assigned.anchor.x), 1, 104),
    y: clamp(mean(observedPositions.map(point => point.y), assigned.anchor.y), 2, 66)
  } : assigned.anchor
  const profile: PlayerTacticalProfile = {
    playerId: assigned.player.id, name: assigned.player.name, shirtNumber: assigned.player.shirtNumber || Number(assigned.player.id.replace(/\D/g, '').slice(-2)) || 0,
    side, position: assigned.player.position === '待配置位置' ? groupLabels[assigned.group] : assigned.player.position,
    role: groupLabels[assigned.group], duty: goalkeeper || defender ? '防守' : attacker ? '进攻' : '支援', anchor,
    runPattern: goalkeeper || defender ? '保持位置' : assigned.group === 'rw' || assigned.group === 'lw' ? '内切' : attacker ? '前插' : '自由跑位',
    passRisk: rounded(28 + (1 - passSuccess) * 42 + forwardShare * 16), passForward: rounded(forwardShare * 100),
    passDirectness: rounded(passDistance / 35 * 100), shootTendency: rounded(shotShare * 260), carryTendency: rounded(carryShare * 230),
    pressIntensity: rounded(42 + defensiveShare * 180), marking: defender ? 70 : rounded(42 + defensiveShare * 90),
    attributes: {
      passing: rounded(40 + passSuccess * 48), firstTouch: rounded(base + passSuccess * 12),
      dribbling: rounded(base + carryShare * 42 + (attacker ? 5 : 0)), shooting: attacker ? rounded(62 + shotShare * 55) : rounded(48 + shotShare * 45),
      pace: assigned.group === 'rw' || assigned.group === 'lw' || assigned.group === 'rb' || assigned.group === 'lb' ? 78 : attacker ? 72 : 66,
      stamina: rounded(64 + Math.min(16, events.length / 8)), decisions: rounded(45 + passSuccess * 42), vision: rounded(43 + forwardShare * 35 + passDistance / 4)
    },
    confidence: observedPositions.length >= 5 ? 'observed' : events.length >= 25 ? 'modelled-high' : 'modelled-low',
    historicalSampleSize: sampleSize
  }
  if (assigned.group === 'gk') profile.goalkeeping = {
    shotStopping: rounded(62 + passSuccess * 12), handling: rounded(60 + passSuccess * 14), aerialReach: 68,
    oneOnOnes: rounded(62 + defensiveShare * 35), rushingOut: rounded(42 + defensiveShare * 85), distribution: rounded(45 + passSuccess * 38 + passDistance / 5)
  }
  return profile
}

function stableSeed(value: string): number {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return Math.abs(hash | 0) || 1
}

export function createScenarioFromBundles(bundles: CanonicalMatchBundle[]): TacticalScenario {
  const bundle = bundles[0]
  if (!bundle) throw new Error('至少需要一场比赛才能创建战术方案')
  const homeTeam = bundle.teams.find(team => team.id === bundle.match.homeTeamId)
  const awayTeam = bundle.teams.find(team => team.id === bundle.match.awayTeamId)
  if (!homeTeam || !awayTeam) throw new Error('比赛数据缺少主队或客队信息，无法创建战术方案')
  const eventMap = new Map<string, MatchEvent[]>()
  const primaryPlayerIds = new Set(bundle.players.map(player => player.id))
  const relatedBundles = [...new Map(bundles.filter(candidate => candidate.source.provider === bundle.source.provider).map(candidate => [candidate.match.id, candidate])).values()]
  const pooledEvents = relatedBundles.flatMap(candidate => candidate.events).filter(event => event.playerId && primaryPlayerIds.has(event.playerId))
  const pooledFrames = relatedBundles.flatMap(candidate => candidate.frames)
  for (const event of pooledEvents) if (event.playerId) {
    const list = eventMap.get(event.playerId) ?? []
    list.push(event); eventMap.set(event.playerId, list)
  }
  const positionMap = new Map<string, Vec2[]>()
  for (const frame of pooledFrames) for (const player of frame.players) if (player.playerId && primaryPlayerIds.has(player.playerId)) {
    const list = positionMap.get(player.playerId) ?? []
    list.push(player.position); positionMap.set(player.playerId, list)
  }
  const buildTeam = (teamId: string, side: TeamSide) => assignSlots(orderedSquad(bundle, teamId), side).map(assigned =>
    profileFromHistory(assigned, side, eventMap.get(assigned.player.id) ?? [], positionMap.get(assigned.player.id) ?? []))
  const home = buildTeam(homeTeam.id, 'home'), away = buildTeam(awayTeam.id, 'away')
  const lowSamplePlayers = [...home, ...away].filter(player => (player.historicalSampleSize ?? 0) < 25).length
  return {
    id: `historical-${bundle.match.id}`, name: `${homeTeam.name} vs ${awayTeam.name} · 历史校准`, sourceMatchId: bundle.match.id,
    startingBall: { x: 18, y: 34 }, possession: 'home', home, away,
    homeTactics: { width: 60, depth: 55, defensiveLine: 52, pressing: 58, transitionSpeed: 55, buildUp: '混合推进', focus: '均衡' },
    awayTactics: { width: 58, depth: 52, defensiveLine: 55, pressing: 60, transitionSpeed: 56, buildUp: '混合推进', focus: '均衡' },
    seed: stableSeed(`${bundle.source.provider}:${bundle.match.id}`), iterations: 1200, maxActions: 10,
    calibration: { provider: bundle.source.provider, sourceMatchId: bundle.match.id, matchCount: relatedBundles.length, eventCount: pooledEvents.length, frameCount: pooledFrames.length, lowSamplePlayers }
  }
}

export function createScenarioFromBundle(bundle: CanonicalMatchBundle): TacticalScenario {
  return createScenarioFromBundles([bundle])
}
