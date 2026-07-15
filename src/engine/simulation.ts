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

function defensivePosition(player: PlayerTacticalProfile, ball: Vec2, tactics: TeamTactics, attackDirection: 1 | -1): Vec2 {
  const individualPress = (player.pressIntensity + tactics.pressing) / 200
  const lineShift = (tactics.defensiveLine - 50) * .18
  const compactness = .08 + player.marking / 260 + individualPress * .12
  const base = { x: player.anchor.x - attackDirection * lineShift, y: 34 + (player.anchor.y - 34) * (.72 + tactics.width / 180) }
  return {
    x: clamp(base.x + (ball.x - base.x) * individualPress * .22, 1, 104),
    y: clamp(base.y + (ball.y - base.y) * compactness, 2, 66)
  }
}

function nearestPressure(point: Vec2, defenders: PlayerTacticalProfile[], tactics: TeamTactics, attackDirection: 1 | -1): number {
  const ranked = defenders.map(player => ({ player, distance: distance(point, defensivePosition(player, point, tactics, attackDirection)) })).sort((a, b) => a.distance - b.distance)
  const nearest = ranked[0]
  const cover = ranked[1] ?? nearest
  return clamp(
    (12 - nearest.distance) / 12 * .52 + (16 - cover.distance) / 16 * .12 +
    tactics.pressing / 100 * .18 + nearest.player.pressIntensity / 100 * .12 + nearest.player.marking / 100 * .06,
    0, 1
  )
}

function movementTarget(player: PlayerTacticalProfile, ball: Vec2, tactics: TeamTactics, random: SeededRandom, attackDirection: 1 | -1): Vec2 {
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
    x: clamp(player.anchor.x + attackDirection * (delta.x + dutyAdvance + depthAdvance + directAdvance) + (random.next() - .5) * 4, 0, 104),
    y: clamp(34 + (player.anchor.y + delta.y - 34) * widthScale + (random.next() - .5) * 4, 2, 66)
  }
}

function chooseBallCarrier(players: PlayerTacticalProfile[], ball: Vec2): PlayerTacticalProfile {
  return [...players].sort((a, b) => distance(a.anchor, ball) - distance(b.anchor, ball))[0]
}

function simulatePossession(scenario: TacticalScenario, iteration: number, collectPositions: boolean): PossessionOutcome {
  const random = new SeededRandom(scenario.seed + iteration * 7919)
  const attackers = scenario.possession === 'home' ? scenario.home : scenario.away
  const defenders = scenario.possession === 'home' ? scenario.away : scenario.home
  const attackTactics = scenario.possession === 'home' ? scenario.homeTactics : scenario.awayTactics
  const defenceTactics = scenario.possession === 'home' ? scenario.awayTactics : scenario.homeTactics
  const attackDirection: 1 | -1 = scenario.possession === 'home' ? 1 : -1
  let ball = { ...scenario.startingBall }
  let carrier = chooseBallCarrier(attackers, ball)
  let retained = true
  let shot = false
  let xg = 0
  let boxEntries = 0
  const lanes: [number, number, number] = [0, 0, 0]
  const actions: SimulationAction[] = []
  const positions: Record<string, Vec2[]> = collectPositions ? Object.fromEntries(attackers.map(player => [player.playerId, [player.anchor]])) : {}

  for (let actionIndex = 0; actionIndex < scenario.maxActions && retained && !shot; actionIndex++) {
    const livePositions = new Map(attackers.map(player => [player.playerId, movementTarget(player, ball, attackTactics, random, attackDirection)]))
    if (collectPositions) for (const [playerId, point] of livePositions) positions[playerId].push(point)
    const carrierPoint = livePositions.get(carrier.playerId) ?? ball
    const pressure = nearestPressure(carrierPoint, defenders, defenceTactics, attackDirection)
    const goalDistance = attackDirection === 1 ? 105 - carrierPoint.x : carrierPoint.x
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
      actions.push({ index: actionIndex, kind: 'shot', playerId: carrier.playerId, start: carrierPoint, end: { x: attackDirection === 1 ? 105 : 0, y: 34 }, success: random.next() < xg, probability: xg, xg, note: `压力 ${Math.round(pressure * 100)}% · xG ${xg.toFixed(2)}` })
      ball = carrierPoint
      break
    }

    if (actionType === 'carry') {
      const advance = 3 + carrier.attributes.dribbling / 17 + attackTactics.transitionSpeed / 28
      const end = { x: clamp(carrierPoint.x + attackDirection * advance, 1, 104), y: clamp(carrierPoint.y + (random.next() - .5) * 8, 2, 66) }
      const successProbability = clamp(sigmoid(1.65 + carrier.attributes.dribbling / 70 + carrier.attributes.pace / 160 - pressure * 3.1), .2, .96)
      const success = random.next() < successProbability
      actions.push({ index: actionIndex, kind: 'carry', playerId: carrier.playerId, start: carrierPoint, end, success, probability: successProbability, note: success ? '带球推进' : '带球被断' })
      ball = end
      retained = success
    } else {
      const candidates = attackers.filter(player => player.playerId !== carrier.playerId).map(player => {
        const point = livePositions.get(player.playerId)!
        const forward = (point.x - carrierPoint.x) * attackDirection
        const passDistance = distance(carrierPoint, point)
        const focusBoost = attackTactics.focus === '均衡' ? 1 : attackTactics.focus === '左路' && point.y < 23 ? 1.45 : attackTactics.focus === '右路' && point.y > 45 ? 1.45 : attackTactics.focus === '中路' && point.y >= 23 && point.y <= 45 ? 1.45 : .8
        const directionPreference = forward >= 0 ? .45 + carrier.passForward / 85 : .6
        const riskFit = 1 - Math.abs(passDistance - (8 + carrier.passDirectness * .34)) / 48
        return { item: { player, point }, weight: Math.max(.04, focusBoost * directionPreference * Math.max(.12, riskFit) * (player.duty === '进攻' ? 1.18 : 1)) }
      })
      const target = random.pickWeighted(candidates)
      const passDistance = distance(carrierPoint, target.point)
      const targetPressure = nearestPressure(target.point, defenders, defenceTactics, attackDirection)
      const forward = (target.point.x - carrierPoint.x) * attackDirection
      const successProbability = clamp(sigmoid(2.3 + carrier.attributes.passing / 90 + carrier.attributes.vision / 220 + target.player.attributes.firstTouch / 240 + carrier.attributes.decisions / 190 - passDistance / 17 - targetPressure * 2.25 - Math.max(0, forward) * carrier.passRisk / 12000), .12, .98)
      const success = random.next() < successProbability
      actions.push({ index: actionIndex, kind: 'pass', playerId: carrier.playerId, targetPlayerId: target.player.playerId, start: carrierPoint, end: target.point, success, probability: successProbability, note: success ? `传给 ${target.player.name}` : '传球被拦截' })
      ball = target.point
      retained = success
      if (success) carrier = target.player
    }

    if ((attackDirection === 1 ? ball.x >= 88 : ball.x <= 17) && ball.y >= 14 && ball.y <= 54) boxEntries++
    const attackingY = attackDirection === 1 ? ball.y : 68 - ball.y
    lanes[attackingY < 23 ? 0 : attackingY > 45 ? 2 : 1]++
  }

  return { actions, shot, xg, retained, boxEntries, progression: Math.max(0, (ball.x - scenario.startingBall.x) * attackDirection), lanes, positions }
}

function wilson(successes: number, total: number): [number, number] {
  if (!total) return [0, 0]
  const z = 1.96, p = successes / total, denominator = 1 + z * z / total
  const centre = (p + z * z / (2 * total)) / denominator
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)]
}

export function validateScenario(scenario: TacticalScenario): void {
  if (!scenario || typeof scenario !== 'object') throw new Error('战术方案无效')
  if (!Number.isInteger(scenario.iterations) || scenario.iterations < 1 || scenario.iterations > 50000) throw new Error('推演次数必须在 1–50000 之间')
  if (!Number.isInteger(scenario.maxActions) || scenario.maxActions < 1 || scenario.maxActions > 50) throw new Error('单回合动作数必须在 1–50 之间')
  if (!Number.isInteger(scenario.seed)) throw new Error('随机种子必须为整数')
  if (!Number.isFinite(scenario.startingBall?.x) || !Number.isFinite(scenario.startingBall?.y) || scenario.startingBall.x < 0 || scenario.startingBall.x > 105 || scenario.startingBall.y < 0 || scenario.startingBall.y > 68) throw new Error('起始球位置必须位于 105 × 68 米球场内')
  if (!['home', 'away'].includes(scenario.possession)) throw new Error('球权方无效')
  if (!scenario.home?.length || !scenario.away?.length || scenario.home.length > 22 || scenario.away.length > 22) throw new Error('双方阵容必须各包含 1–22 名球员')
  const players = [...scenario.home, ...scenario.away]
  if (new Set(players.map(player => player.playerId)).size !== players.length) throw new Error('球员 ID 必须唯一')
  for (const player of players) {
    if (!player.playerId || !player.name) throw new Error('球员 ID 和姓名不能为空')
    if (!Number.isFinite(player.anchor?.x) || !Number.isFinite(player.anchor?.y) || player.anchor.x < 0 || player.anchor.x > 105 || player.anchor.y < 0 || player.anchor.y > 68) throw new Error(`${player.name} 的站位超出球场范围`)
    const values = [player.passRisk, player.passForward, player.passDirectness, player.shootTendency, player.carryTendency, player.pressIntensity, player.marking, ...Object.values(player.attributes)]
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error(`${player.name} 的倾向或属性必须在 0–100 之间`)
  }
  for (const tactics of [scenario.homeTactics, scenario.awayTactics]) {
    const values = [tactics.width, tactics.depth, tactics.defensiveLine, tactics.pressing, tactics.transitionSpeed]
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error('球队战术参数必须在 0–100 之间')
  }
}

export function simulateScenario(scenario: TacticalScenario): SimulationResult {
  validateScenario(scenario)
  let shotCount = 0, retainedCount = 0, xgTotal = 0, boxEntryTotal = 0, progressionTotal = 0
  let representativeSuccess: PossessionOutcome | undefined, representativeFailure: PossessionOutcome | undefined
  let firstOutcome: PossessionOutcome | undefined, lastOutcome: PossessionOutcome | undefined
  const laneTotals: [number, number, number] = [0, 0, 0]
  const playerHeatmaps: Record<string, Vec2[]> = {}
  const edges = new Map<string, { from: string; to: string; count: number; success: number }>()
  const sampleStride = Math.max(1, Math.floor(scenario.iterations / 120))
  for (let index = 0; index < scenario.iterations; index++) {
    const collectPositions = index % sampleStride === 0
    const outcome = simulatePossession(scenario, index, collectPositions)
    firstOutcome ??= outcome; lastOutcome = outcome
    if (outcome.shot) {
      shotCount++
      if (!representativeSuccess || outcome.xg > representativeSuccess.xg) representativeSuccess = outcome
    }
    if (outcome.retained) retainedCount++
    else representativeFailure ??= outcome
    xgTotal += outcome.xg; boxEntryTotal += outcome.boxEntries; progressionTotal += outcome.progression
    laneTotals[0] += outcome.lanes[0]; laneTotals[1] += outcome.lanes[1]; laneTotals[2] += outcome.lanes[2]
    if (collectPositions) for (const [playerId, points] of Object.entries(outcome.positions)) (playerHeatmaps[playerId] ??= []).push(...points)
    for (const action of outcome.actions) if (action.kind === 'pass' && action.targetPlayerId) {
      const key = `${action.playerId}>${action.targetPlayerId}`
      const edge = edges.get(key) ?? { from: action.playerId, to: action.targetPlayerId, count: 0, success: 0 }
      edge.count++; if (action.success) edge.success++; edges.set(key, edge)
    }
  }
  const totalLaneActions = laneTotals.reduce((sum, value) => sum + value, 0) || 1
  const metrics: SimulationMetrics = {
    possessions: scenario.iterations,
    shotRate: shotCount / scenario.iterations,
    averageXg: xgTotal / scenario.iterations,
    boxEntries: boxEntryTotal / scenario.iterations,
    retentionRate: retainedCount / scenario.iterations,
    averageProgression: progressionTotal / scenario.iterations,
    leftShare: laneTotals[0] / totalLaneActions,
    centreShare: laneTotals[1] / totalLaneActions,
    rightShare: laneTotals[2] / totalLaneActions
  }
  const successful = representativeSuccess ?? firstOutcome!
  const failure = representativeFailure ?? lastOutcome!
  const qualityNotes = ['结果来自概率模型，不是对真实比赛结果的预测。', '无逐帧追踪数据时，无球跑位由职责模板推断。']
  if (scenario.calibration) {
    qualityNotes.push(`历史校准：${scenario.calibration.provider} · ${scenario.calibration.eventCount} 个事件 · ${scenario.calibration.frameCount} 个空间帧。`)
    if (scenario.calibration.lowSamplePlayers) qualityNotes.push(`${scenario.calibration.lowSamplePlayers} 名球员样本较少，已使用位置先验平滑并标记低置信度。`)
  } else qualityNotes.push('当前方案未绑定历史比赛；球员属性为模型估计。')
  return {
    scenarioId: scenario.id, seed: scenario.seed, createdAt: new Date().toISOString(), metrics,
    confidenceInterval: { shotRate: wilson(shotCount, scenario.iterations), retentionRate: wilson(retainedCount, scenario.iterations) },
    representativeSuccess: successful.actions, representativeFailure: failure.actions, playerHeatmaps,
    passNetwork: [...edges.values()].map(edge => ({ from: edge.from, to: edge.to, count: edge.count, successRate: edge.success / edge.count })).sort((a, b) => b.count - a.count).slice(0, 18),
    qualityNotes
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
