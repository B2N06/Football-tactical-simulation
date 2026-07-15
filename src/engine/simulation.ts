import type { PlayerTacticalProfile, SimulationAction, SimulationMetrics, SimulationResult, TacticalScenario, TeamTactics, Vec2 } from '../types'
import { clamp, distance } from './coordinates'
import { SeededRandom } from './random'

interface PossessionOutcome {
  actions: SimulationAction[]
  shot: boolean
  xg: number
  retained: boolean
  boxEntries: number
  progression: number
  lanes: [number, number, number]
  positions: Record<string, Vec2[]>
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))

function defensivePosition(player: PlayerTacticalProfile, ball: Vec2, tactics: TeamTactics): Vec2 {
  const individualPress = (player.pressIntensity + tactics.pressing) / 200
  const lineShift = (tactics.defensiveLine - 50) * .18
  const compactness = .08 + player.marking / 260 + individualPress * .12
  const base = { x: player.anchor.x - lineShift, y: 34 + (player.anchor.y - 34) * (.72 + tactics.width / 180) }
  return {
    x: clamp(base.x + (ball.x - base.x) * individualPress * .22, 1, 104),
    y: clamp(base.y + (ball.y - base.y) * compactness, 2, 66)
  }
}

function nearestPressure(point: Vec2, defenders: PlayerTacticalProfile[], tactics: TeamTactics): number {
  const ranked = defenders.map(player => ({ player, distance: distance(point, defensivePosition(player, point, tactics)) })).sort((a, b) => a.distance - b.distance)
  const nearest = ranked[0]
  const cover = ranked[1]
  return clamp(
    (12 - nearest.distance) / 12 * .52 + (16 - cover.distance) / 16 * .12 +
    tactics.pressing / 100 * .18 + nearest.player.pressIntensity / 100 * .12 + nearest.player.marking / 100 * .06,
    0, 1
  )
}

function movementTarget(player: PlayerTacticalProfile, ball: Vec2, tactics: TeamTactics, random: SeededRandom): Vec2 {
  const dutyAdvance = player.duty === '进攻' ? 9 : player.duty === '支援' ? 4 : 0
  const deltas: Record<PlayerTacticalProfile['runPattern'], Vec2> = {
    '保持位置': { x: 0, y: 0 }, '前插': { x: 12, y: 0 }, '回撤接应': { x: -7, y: (ball.y - player.anchor.y) * .25 },
    '套边': { x: 8, y: player.anchor.y < 34 ? -5 : 5 }, '内切': { x: 8, y: (34 - player.anchor.y) * .45 },
    '自由跑位': { x: 5, y: (random.next() - .5) * 13 }
  }
  const delta = deltas[player.runPattern]
  const widthScale = .62 + tactics.width / 130
  const depthAdvance = (tactics.depth - 50) * .12
  const directAdvance = tactics.buildUp === '快速直接' ? 4 : tactics.buildUp === '混合推进' ? 1.5 : 0
  return {
    x: clamp(player.anchor.x + delta.x + dutyAdvance + depthAdvance + directAdvance + (random.next() - .5) * 4, 0, 104),
    y: clamp(34 + (player.anchor.y + delta.y - 34) * widthScale + (random.next() - .5) * 4, 2, 66)
  }
}

function chooseBallCarrier(players: PlayerTacticalProfile[], ball: Vec2): PlayerTacticalProfile {
  return [...players].sort((a, b) => distance(a.anchor, ball) - distance(b.anchor, ball))[0]
}

function simulatePossession(scenario: TacticalScenario, iteration: number): PossessionOutcome {
  const random = new SeededRandom(scenario.seed + iteration * 7919)
  const attackers = scenario.possession === 'home' ? scenario.home : scenario.away
  const defenders = scenario.possession === 'home' ? scenario.away : scenario.home
  const attackTactics = scenario.possession === 'home' ? scenario.homeTactics : scenario.awayTactics
  const defenceTactics = scenario.possession === 'home' ? scenario.awayTactics : scenario.homeTactics
  let ball = { ...scenario.startingBall }
  let carrier = chooseBallCarrier(attackers, ball)
  let retained = true
  let shot = false
  let xg = 0
  let boxEntries = 0
  const lanes: [number, number, number] = [0, 0, 0]
  const actions: SimulationAction[] = []
  const positions: Record<string, Vec2[]> = Object.fromEntries(attackers.map(player => [player.playerId, [player.anchor]]))

  for (let actionIndex = 0; actionIndex < scenario.maxActions && retained && !shot; actionIndex++) {
    const livePositions = new Map(attackers.map(player => [player.playerId, movementTarget(player, ball, attackTactics, random)]))
    for (const [playerId, point] of livePositions) positions[playerId].push(point)
    const carrierPoint = livePositions.get(carrier.playerId) ?? ball
    const pressure = nearestPressure(carrierPoint, defenders, defenceTactics)
    const goalDistance = 105 - carrierPoint.x
    const shotWeight = goalDistance < 32 ? (carrier.shootTendency / 100) * (1.25 - goalDistance / 55) : .01
    const carryWeight = (carrier.carryTendency / 100) * (1 - pressure * .55) * (.75 + attackTactics.transitionSpeed / 200) * (attackTactics.buildUp === '混合推进' ? 1.12 : 1)
    const passWeight = .7 + carrier.passForward / 180 + (attackTactics.buildUp === '短传组织' ? .25 : attackTactics.buildUp === '快速直接' ? .08 : .14)
    const actionType = random.pickWeighted([
      { item: 'shot' as const, weight: shotWeight }, { item: 'carry' as const, weight: carryWeight }, { item: 'pass' as const, weight: passWeight }
    ])

    if (actionType === 'shot') {
      const angleFactor = 1 - Math.min(1, Math.abs(carrierPoint.y - 34) / 34)
      xg = clamp(sigmoid(-3.25 + (32 - goalDistance) * .085 + angleFactor * 1.05 + carrier.attributes.shooting / 120 - pressure * 1.2), .01, .75)
      shot = true
      actions.push({ index: actionIndex, kind: 'shot', playerId: carrier.playerId, start: carrierPoint, end: { x: 105, y: 34 }, success: random.next() < xg, probability: xg, xg, note: `压力 ${Math.round(pressure * 100)}% · xG ${xg.toFixed(2)}` })
      ball = carrierPoint
      break
    }

    if (actionType === 'carry') {
      const advance = 3 + carrier.attributes.dribbling / 17 + attackTactics.transitionSpeed / 28
      const end = { x: clamp(carrierPoint.x + advance, 0, 103), y: clamp(carrierPoint.y + (random.next() - .5) * 8, 2, 66) }
      const successProbability = clamp(sigmoid(1.65 + carrier.attributes.dribbling / 70 + carrier.attributes.pace / 160 - pressure * 3.1), .2, .96)
      const success = random.next() < successProbability
      actions.push({ index: actionIndex, kind: 'carry', playerId: carrier.playerId, start: carrierPoint, end, success, probability: successProbability, note: success ? '带球推进' : '带球被断' })
      ball = end
      retained = success
    } else {
      const candidates = attackers.filter(player => player.playerId !== carrier.playerId).map(player => {
        const point = livePositions.get(player.playerId)!
        const forward = point.x - carrierPoint.x
        const passDistance = distance(carrierPoint, point)
        const focusBoost = attackTactics.focus === '均衡' ? 1 : attackTactics.focus === '左路' && point.y < 23 ? 1.45 : attackTactics.focus === '右路' && point.y > 45 ? 1.45 : attackTactics.focus === '中路' && point.y >= 23 && point.y <= 45 ? 1.45 : .8
        const directionPreference = forward >= 0 ? .45 + carrier.passForward / 85 : .6
        const riskFit = 1 - Math.abs(passDistance - (8 + carrier.passDirectness * .34)) / 48
        return { item: { player, point }, weight: Math.max(.04, focusBoost * directionPreference * Math.max(.12, riskFit) * (player.duty === '进攻' ? 1.18 : 1)) }
      })
      const target = random.pickWeighted(candidates)
      const passDistance = distance(carrierPoint, target.point)
      const targetPressure = nearestPressure(target.point, defenders, defenceTactics)
      const forward = target.point.x - carrierPoint.x
      const successProbability = clamp(sigmoid(2.3 + carrier.attributes.passing / 90 + carrier.attributes.vision / 220 + target.player.attributes.firstTouch / 240 + carrier.attributes.decisions / 190 - passDistance / 17 - targetPressure * 2.25 - Math.max(0, forward) * carrier.passRisk / 12000), .12, .98)
      const success = random.next() < successProbability
      actions.push({ index: actionIndex, kind: 'pass', playerId: carrier.playerId, targetPlayerId: target.player.playerId, start: carrierPoint, end: target.point, success, probability: successProbability, note: success ? `传给 ${target.player.name}` : '传球被拦截' })
      ball = target.point
      retained = success
      if (success) carrier = target.player
    }

    if (ball.x >= 88 && ball.y >= 14 && ball.y <= 54) boxEntries++
    lanes[ball.y < 23 ? 0 : ball.y > 45 ? 2 : 1]++
  }

  return { actions, shot, xg, retained, boxEntries, progression: Math.max(0, ball.x - scenario.startingBall.x), lanes, positions }
}

function wilson(successes: number, total: number): [number, number] {
  if (!total) return [0, 0]
  const z = 1.96, p = successes / total, denominator = 1 + z * z / total
  const centre = (p + z * z / (2 * total)) / denominator
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)]
}

export function simulateScenario(scenario: TacticalScenario): SimulationResult {
  if (scenario.iterations < 1 || scenario.iterations > 50000) throw new Error('推演次数必须在 1–50000 之间')
  const outcomes = Array.from({ length: scenario.iterations }, (_, index) => simulatePossession(scenario, index))
  const shotCount = outcomes.filter(item => item.shot).length
  const retainedCount = outcomes.filter(item => item.retained).length
  const laneTotals = outcomes.reduce((sum, item) => sum.map((value, index) => value + item.lanes[index]) as [number, number, number], [0, 0, 0])
  const totalLaneActions = laneTotals.reduce((sum, value) => sum + value, 0) || 1
  const metrics: SimulationMetrics = {
    possessions: scenario.iterations,
    shotRate: shotCount / scenario.iterations,
    averageXg: outcomes.reduce((sum, item) => sum + item.xg, 0) / scenario.iterations,
    boxEntries: outcomes.reduce((sum, item) => sum + item.boxEntries, 0) / scenario.iterations,
    retentionRate: retainedCount / scenario.iterations,
    averageProgression: outcomes.reduce((sum, item) => sum + item.progression, 0) / scenario.iterations,
    leftShare: laneTotals[0] / totalLaneActions,
    centreShare: laneTotals[1] / totalLaneActions,
    rightShare: laneTotals[2] / totalLaneActions
  }
  const successful = outcomes.filter(item => item.shot).sort((a, b) => b.xg - a.xg)[0] ?? outcomes[0]
  const failure = outcomes.find(item => !item.retained) ?? outcomes.at(-1)!
  const playerHeatmaps: Record<string, Vec2[]> = {}
  for (const outcome of outcomes.filter((_, index) => index % Math.max(1, Math.floor(outcomes.length / 120)) === 0)) {
    for (const [playerId, points] of Object.entries(outcome.positions)) (playerHeatmaps[playerId] ??= []).push(...points)
  }
  const edges = new Map<string, { from: string; to: string; count: number; success: number }>()
  for (const outcome of outcomes) for (const action of outcome.actions) if (action.kind === 'pass' && action.targetPlayerId) {
    const key = `${action.playerId}>${action.targetPlayerId}`
    const edge = edges.get(key) ?? { from: action.playerId, to: action.targetPlayerId, count: 0, success: 0 }
    edge.count++; if (action.success) edge.success++; edges.set(key, edge)
  }
  return {
    scenarioId: scenario.id, seed: scenario.seed, createdAt: new Date().toISOString(), metrics,
    confidenceInterval: { shotRate: wilson(shotCount, scenario.iterations), retentionRate: wilson(retainedCount, scenario.iterations) },
    representativeSuccess: successful.actions, representativeFailure: failure.actions, playerHeatmaps,
    passNetwork: [...edges.values()].map(edge => ({ from: edge.from, to: edge.to, count: edge.count, successRate: edge.success / edge.count })).sort((a, b) => b.count - a.count).slice(0, 18),
    qualityNotes: ['结果来自概率模型，不是对真实比赛结果的预测。', '示例球员属性为模型估计；导入事件或追踪数据后可提高置信度。', '无逐帧追踪数据时，无球跑位由职责模板推断。']
  }
}

export function compareScenarios(baseline: TacticalScenario, modified: TacticalScenario) {
  const baselineResult = simulateScenario(baseline)
  const modifiedResult = simulateScenario(modified)
  return {
    baseline: baselineResult, modified: modifiedResult,
    deltas: {
      shotRate: modifiedResult.metrics.shotRate - baselineResult.metrics.shotRate,
      averageXg: modifiedResult.metrics.averageXg - baselineResult.metrics.averageXg,
      boxEntries: modifiedResult.metrics.boxEntries - baselineResult.metrics.boxEntries,
      retentionRate: modifiedResult.metrics.retentionRate - baselineResult.metrics.retentionRate,
      averageProgression: modifiedResult.metrics.averageProgression - baselineResult.metrics.averageProgression
    }
  }
}
