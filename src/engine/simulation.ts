import type { PlayerTacticalProfile, SimulationAction, SimulationMetrics, SimulationResult, TacticalScenario, TeamTactics, Vec2 } from '../types'
import { clamp, distance } from './coordinates'
import { getGoalkeepingAttributes, getTacticalPositionGroup, validatePlayerInstructions } from './playerInstructions'
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

function isGoalkeeper(player: PlayerTacticalProfile): boolean {
  return getTacticalPositionGroup(player) === 'goalkeeper'
}

function moveTowards(current: Vec2, target: Vec2, maximumDistance: number): Vec2 {
  const separation = distance(current, target)
  if (!separation || separation <= maximumDistance) return target
  const ratio = maximumDistance / separation
  return { x: current.x + (target.x - current.x) * ratio, y: current.y + (target.y - current.y) * ratio }
}

function defensiveTarget(player: PlayerTacticalProfile, ball: Vec2, tactics: TeamTactics, attackDirection: 1 | -1, attackers: PlayerTacticalProfile[], attackerPositions: Map<string, Vec2>): Vec2 {
  const individualPress = (player.pressIntensity + tactics.pressing) / 200
  const lineShift = (tactics.defensiveLine - 50) * .18
  const compactness = .08 + player.marking / 260 + individualPress * .12
  const base = { x: player.anchor.x - attackDirection * lineShift, y: 34 + (player.anchor.y - 34) * (.72 + tactics.width / 180) }
  if (isGoalkeeper(player)) {
    const goalkeeping = getGoalkeepingAttributes(player)
    const rushingWeight = .015 + goalkeeping.rushingOut / 100 * .075
    return {
      x: clamp(base.x + (ball.x - base.x) * rushingWeight, player.side === 'home' ? 1 : 92, player.side === 'home' ? 13 : 104),
      y: clamp(base.y + (ball.y - base.y) * (.04 + goalkeeping.rushingOut / 1250), 24, 44)
    }
  }
  let mark: Vec2 | undefined, markDistance = Number.POSITIVE_INFINITY
  for (const attacker of attackers) {
    const point = attackerPositions.get(attacker.playerId)
    if (!point) continue
    const candidateDistance = distance(player.anchor, point)
    if (candidateDistance < markDistance) { mark = point; markDistance = candidateDistance }
  }
  const markingWeight = player.marking / 100 * .34
  const pressingWeight = individualPress * .25
  return {
    x: clamp(base.x + (ball.x - base.x) * pressingWeight + ((mark?.x ?? base.x) - base.x) * markingWeight, 1, 104),
    y: clamp(base.y + (ball.y - base.y) * compactness + ((mark?.y ?? base.y) - base.y) * markingWeight, 2, 66)
  }
}

function nearestPressure(point: Vec2, defenders: PlayerTacticalProfile[], positions: Map<string, Vec2>, tactics: TeamTactics): number {
  let nearest: { player: PlayerTacticalProfile; distance: number } | undefined
  let cover: { player: PlayerTacticalProfile; distance: number } | undefined
  for (const player of defenders) {
    const candidate = { player, distance: distance(point, positions.get(player.playerId) ?? player.anchor) }
    if (!nearest || candidate.distance < nearest.distance) { cover = nearest; nearest = candidate }
    else if (!cover || candidate.distance < cover.distance) cover = candidate
  }
  if (!nearest) return 0
  cover ??= nearest
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
  let closest = players[0], closestDistance = distance(players[0].anchor, ball)
  for (let index = 1; index < players.length; index++) {
    const candidateDistance = distance(players[index].anchor, ball)
    if (candidateDistance < closestDistance) { closest = players[index]; closestDistance = candidateDistance }
  }
  return closest
}

function simulatePossession(scenario: TacticalScenario, iteration: number, collectPositions: boolean): PossessionOutcome {
  const random = new SeededRandom((scenario.seed >>> 0) + iteration * 7919)
  const attackers = scenario.possession === 'home' ? scenario.home : scenario.away
  const defenders = scenario.possession === 'home' ? scenario.away : scenario.home
  const attackTactics = scenario.possession === 'home' ? scenario.homeTactics : scenario.awayTactics
  const defenceTactics = scenario.possession === 'home' ? scenario.awayTactics : scenario.homeTactics
  const attackDirection: 1 | -1 = scenario.possession === 'home' ? 1 : -1
  let ball = { ...scenario.startingBall }
  let controlledBall = { ...ball }
  let carrier = chooseBallCarrier(attackers, ball)
  let retained = true
  let shot = false
  let xg = 0
  let boxEntries = 0
  const lanes: [number, number, number] = [0, 0, 0]
  const actions: SimulationAction[] = []
  const allPlayers = [...attackers, ...defenders]
  const positions: Record<string, Vec2[]> = collectPositions ? Object.fromEntries(allPlayers.map(player => [player.playerId, [player.anchor]])) : {}
  const attackerPositions = new Map(attackers.map(player => [player.playerId, { ...player.anchor }]))
  const defenderPositions = new Map(defenders.map(player => [player.playerId, { ...player.anchor }]))
  attackerPositions.set(carrier.playerId, { ...ball })

  for (let actionIndex = 0; actionIndex < scenario.maxActions && retained && !shot; actionIndex++) {
    for (const player of attackers) {
      if (player.playerId === carrier.playerId) { attackerPositions.set(player.playerId, { ...ball }); continue }
      const current = attackerPositions.get(player.playerId) ?? player.anchor
      const target = movementTarget(player, ball, attackTactics, random, attackDirection)
      attackerPositions.set(player.playerId, moveTowards(current, target, 2.6 + player.attributes.pace / 42 + player.attributes.stamina / 100))
    }
    for (const player of defenders) {
      const current = defenderPositions.get(player.playerId) ?? player.anchor
      const target = defensiveTarget(player, ball, defenceTactics, attackDirection, attackers, attackerPositions)
      defenderPositions.set(player.playerId, moveTowards(current, target, 2.4 + player.attributes.pace / 45 + player.attributes.stamina / 110))
    }
    if (collectPositions) {
      for (const [playerId, point] of attackerPositions) positions[playerId].push(point)
      for (const [playerId, point] of defenderPositions) positions[playerId].push(point)
    }
    const carrierPoint = attackerPositions.get(carrier.playerId) ?? ball
    const pressure = nearestPressure(carrierPoint, defenders, defenderPositions, defenceTactics)
    const goalDistance = attackDirection === 1 ? 105 - carrierPoint.x : carrierPoint.x
    const shotWeight = carrier.shootTendency / 100 * (goalDistance < 32 ? 1.25 - goalDistance / 55 : .01)
    const carryWeight = (carrier.carryTendency / 100) * (1 - pressure * .55) * (.75 + attackTactics.transitionSpeed / 200) * (attackTactics.buildUp === '混合推进' ? 1.12 : 1)
    const passWeight = attackers.length > 1 ? .7 + carrier.passForward / 180 + (attackTactics.buildUp === '短传组织' ? .25 : attackTactics.buildUp === '快速直接' ? .08 : .14) : 0
    if (shotWeight + carryWeight + passWeight <= 0) break
    const actionType = random.pickWeighted([
      { item: 'shot' as const, weight: shotWeight }, { item: 'carry' as const, weight: carryWeight }, { item: 'pass' as const, weight: passWeight }
    ])

    if (actionType === 'shot') {
      const angleFactor = 1 - Math.min(1, Math.abs(carrierPoint.y - 34) / 34)
      const goalkeeper = defenders.find(isGoalkeeper)
      const goalkeeperSkill = goalkeeper ? getGoalkeepingAttributes(goalkeeper) : undefined
      const saveAdjustment = goalkeeperSkill ? ((goalkeeperSkill.shotStopping - 50) * .7 + (goalkeeperSkill.oneOnOnes - 50) * (goalDistance < 16 ? .5 : .25)) / 70 : 0
      xg = clamp(sigmoid(-3.25 + (32 - goalDistance) * .085 + angleFactor * 1.05 + carrier.attributes.shooting / 120 - pressure * 1.2 - saveAdjustment), .01, .75)
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
        const point = attackerPositions.get(player.playerId)!
        const forward = (point.x - carrierPoint.x) * attackDirection
        const passDistance = distance(carrierPoint, point)
        const attackingY = attackDirection === 1 ? point.y : 68 - point.y
        const focusBoost = attackTactics.focus === '均衡' ? 1 : attackTactics.focus === '左路' && attackingY < 23 ? 1.45 : attackTactics.focus === '右路' && attackingY > 45 ? 1.45 : attackTactics.focus === '中路' && attackingY >= 23 && attackingY <= 45 ? 1.45 : .8
        const directionPreference = forward >= 0 ? .45 + carrier.passForward / 85 : .6
        const riskFit = 1 - Math.abs(passDistance - (8 + carrier.passDirectness * .34)) / 48
        return { item: { player, point }, weight: Math.max(.04, focusBoost * directionPreference * Math.max(.12, riskFit) * (player.duty === '进攻' ? 1.18 : 1)) }
      })
      const target = random.pickWeighted(candidates)
      const passDistance = distance(carrierPoint, target.point)
      const targetPressure = nearestPressure(target.point, defenders, defenderPositions, defenceTactics)
      const forward = (target.point.x - carrierPoint.x) * attackDirection
      const passingAbility = isGoalkeeper(carrier) ? (carrier.attributes.passing + getGoalkeepingAttributes(carrier).distribution) / 2 : carrier.attributes.passing
      const successProbability = clamp(sigmoid(2.3 + passingAbility / 90 + carrier.attributes.vision / 220 + target.player.attributes.firstTouch / 240 + carrier.attributes.decisions / 190 - passDistance / 17 - targetPressure * 2.25 - Math.max(0, forward) * carrier.passRisk / 12000), .12, .98)
      const success = random.next() < successProbability
      actions.push({ index: actionIndex, kind: 'pass', playerId: carrier.playerId, targetPlayerId: target.player.playerId, start: carrierPoint, end: target.point, success, probability: successProbability, note: success ? `传给 ${target.player.name}` : '传球被拦截' })
      ball = target.point
      retained = success
      if (success) { carrier = target.player; attackerPositions.set(carrier.playerId, { ...ball }) }
    }

    const inBox = (point: Vec2) => (attackDirection === 1 ? point.x >= 88.5 : point.x <= 16.5) && point.y >= 13.84 && point.y <= 54.16
    if (retained) {
      if (!inBox(carrierPoint) && inBox(ball)) boxEntries++
      controlledBall = { ...ball }
    }
    const attackingY = attackDirection === 1 ? ball.y : 68 - ball.y
    lanes[attackingY < 23 ? 0 : attackingY > 45 ? 2 : 1]++
  }

  return { actions, shot, xg, retained, boxEntries, progression: Math.max(0, (controlledBall.x - scenario.startingBall.x) * attackDirection), lanes, positions }
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
  if (!Number.isSafeInteger(scenario.seed)) throw new Error('随机种子必须为安全整数')
  if (!Number.isFinite(scenario.startingBall?.x) || !Number.isFinite(scenario.startingBall?.y) || scenario.startingBall.x < 0 || scenario.startingBall.x > 105 || scenario.startingBall.y < 0 || scenario.startingBall.y > 68) throw new Error('起始球位置必须位于 105 × 68 米球场内')
  if (!['home', 'away'].includes(scenario.possession)) throw new Error('球权方无效')
  if (!Array.isArray(scenario.home) || !Array.isArray(scenario.away) || !scenario.home.length || !scenario.away.length || scenario.home.length > 22 || scenario.away.length > 22) throw new Error('双方阵容必须各包含 1–22 名球员')
  const players = [...scenario.home, ...scenario.away]
  if (players.some(player => !player || typeof player !== 'object')) throw new Error('球员数据无效')
  if (new Set(players.map(player => player.playerId)).size !== players.length) throw new Error('球员 ID 必须唯一')
  if (scenario.home.some(player => player.side !== 'home') || scenario.away.some(player => player.side !== 'away')) throw new Error('球员所属方与阵容不一致')
  for (const player of players) {
    if (typeof player.playerId !== 'string' || !player.playerId.trim() || typeof player.name !== 'string' || !player.name.trim()) throw new Error('球员 ID 和姓名不能为空')
    if (!Number.isFinite(player.anchor?.x) || !Number.isFinite(player.anchor?.y) || player.anchor.x < 0 || player.anchor.x > 105 || player.anchor.y < 0 || player.anchor.y > 68) throw new Error(`${player.name} 的站位超出球场范围`)
    const attributeKeys: Array<keyof PlayerTacticalProfile['attributes']> = ['passing', 'firstTouch', 'dribbling', 'shooting', 'pace', 'stamina', 'decisions', 'vision']
    const values = [player.passRisk, player.passForward, player.passDirectness, player.shootTendency, player.carryTendency, player.pressIntensity, player.marking, ...attributeKeys.map(key => player.attributes?.[key])]
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error(`${player.name} 的倾向或属性必须在 0–100 之间`)
    const instructionError = validatePlayerInstructions(player)
    if (instructionError) throw new Error(instructionError)
    const goalkeepingKeys: Array<keyof NonNullable<PlayerTacticalProfile['goalkeeping']>> = ['shotStopping', 'handling', 'aerialReach', 'oneOnOnes', 'rushingOut', 'distribution']
    if (player.goalkeeping && goalkeepingKeys.some(key => !Number.isFinite(player.goalkeeping![key]) || player.goalkeeping![key] < 0 || player.goalkeeping![key] > 100)) throw new Error(`${player.name} 的门将专项属性必须在 0–100 之间`)
  }
  for (const tactics of [scenario.homeTactics, scenario.awayTactics]) {
    if (!tactics || typeof tactics !== 'object') throw new Error('球队战术参数缺失')
    const values = [tactics.width, tactics.depth, tactics.defensiveLine, tactics.pressing, tactics.transitionSpeed]
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error('球队战术参数必须在 0–100 之间')
    if (!['短传组织', '混合推进', '快速直接'].includes(tactics.buildUp) || !['左路', '中路', '右路', '均衡'].includes(tactics.focus)) throw new Error('球队组织方式或进攻侧重无效')
  }
}

export function simulateScenario(scenario: TacticalScenario, onProgress?: (completed: number, total: number) => void): SimulationResult {
  validateScenario(scenario)
  let shotCount = 0, retainedCount = 0, xgTotal = 0, boxEntryTotal = 0, progressionTotal = 0
  let representativeSuccess: PossessionOutcome | undefined, representativeFailure: PossessionOutcome | undefined
  let firstOutcome: PossessionOutcome | undefined, lastOutcome: PossessionOutcome | undefined
  const laneTotals: [number, number, number] = [0, 0, 0]
  const playerHeatmaps: Record<string, Vec2[]> = {}
  const edges = new Map<string, { from: string; to: string; count: number; success: number }>()
  const sampleStride = Math.max(1, Math.floor(scenario.iterations / 120))
  const progressStride = Math.max(1, Math.floor(scenario.iterations / 100))
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
    if (onProgress && ((index + 1) % progressStride === 0 || index + 1 === scenario.iterations)) onProgress(index + 1, scenario.iterations)
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
  const qualityNotes = ['结果来自概率模型，不是对真实比赛结果的预测。', '双方球员位置按连续移动、压迫与盯人职责动态更新；无逐帧追踪数据时仍属于模型推断。']
  if (scenario.calibration) {
    qualityNotes.push(`历史校准：${scenario.calibration.provider} · ${scenario.calibration.matchCount ?? 1} 场比赛 · ${scenario.calibration.eventCount} 个事件 · ${scenario.calibration.frameCount} 个空间帧。`)
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

export function compareScenarios(baseline: TacticalScenario, modified: TacticalScenario, onProgress?: (progress: number, phase: 'baseline' | 'modified') => void) {
  if (baseline.iterations !== modified.iterations) throw new Error('基准与修改方案必须使用相同推演次数')
  if (baseline.seed !== modified.seed) throw new Error('基准与修改方案必须使用相同随机种子')
  if (baseline.maxActions !== modified.maxActions) throw new Error('基准与修改方案必须使用相同单回合动作数')
  const baselineResult = simulateScenario(baseline, (completed, total) => onProgress?.(completed / total * .5, 'baseline'))
  const modifiedResult = simulateScenario(modified, (completed, total) => onProgress?.(.5 + completed / total * .5, 'modified'))
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
