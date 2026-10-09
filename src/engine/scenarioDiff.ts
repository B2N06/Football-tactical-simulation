import type { PlayerTacticalProfile, TacticalScenario, TeamTactics } from '../types'

export interface ScenarioChangeSummary {
  total: number
  playerCount: number
  teamSettingCount: number
  changedPlayerNames: string[]
  labels: string[]
}

const playerFields: Array<keyof PlayerTacticalProfile> = [
  'role', 'duty', 'anchor', 'runPattern', 'passRisk', 'passForward', 'passDirectness',
  'shootTendency', 'carryTendency', 'pressIntensity', 'marking', 'attributes', 'goalkeeping'
]

const teamFields: Array<keyof TeamTactics> = [
  'width', 'depth', 'defensiveLine', 'pressing', 'transitionSpeed', 'buildUp', 'focus'
]

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

export function describePlayerChanges(baseline: PlayerTacticalProfile | undefined, current: PlayerTacticalProfile): string[] {
  if (!baseline) return ['新加入方案']
  const changes: string[] = []
  if (baseline.role !== current.role) changes.push(`角色 ${baseline.role} → ${current.role}`)
  if (baseline.duty !== current.duty) changes.push(`职责 ${baseline.duty} → ${current.duty}`)
  if (baseline.runPattern !== current.runPattern) changes.push(`跑位 ${baseline.runPattern} → ${current.runPattern}`)
  if (!same(baseline.anchor, current.anchor)) changes.push('站位已调整')

  const tendencyFields: Array<keyof PlayerTacticalProfile> = [
    'passRisk', 'passForward', 'passDirectness', 'shootTendency', 'carryTendency', 'pressIntensity', 'marking'
  ]
  const tendencyCount = tendencyFields.filter(field => baseline[field] !== current[field]).length
  if (tendencyCount) changes.push(`${tendencyCount} 项行为倾向`)
  if (!same(baseline.attributes, current.attributes)) changes.push('基础属性已调整')
  if (!same(baseline.goalkeeping, current.goalkeeping)) changes.push('门将专项已调整')
  return changes
}

export function summarizeScenarioChanges(baseline: TacticalScenario, current: TacticalScenario): ScenarioChangeSummary {
  const baselinePlayers = new Map([...baseline.home, ...baseline.away].map(player => [player.playerId, player]))
  const changedPlayers = [...current.home, ...current.away].filter(player => {
    const reference = baselinePlayers.get(player.playerId)
    return !reference || playerFields.some(field => !same(reference[field], player[field]))
  })

  const changedTeamFields = (['homeTactics', 'awayTactics'] as const).flatMap(key =>
    teamFields.filter(field => !same(baseline[key][field], current[key][field])).map(field => `${key}:${field}`)
  )
  const labels = changedPlayers.slice(0, 3).map(player => player.name)
  if (changedPlayers.length > 3) labels.push(`另 ${changedPlayers.length - 3} 人`)
  if (changedTeamFields.length) labels.push(`${changedTeamFields.length} 项整体战术`)

  return {
    total: changedPlayers.length + changedTeamFields.length,
    playerCount: changedPlayers.length,
    teamSettingCount: changedTeamFields.length,
    changedPlayerNames: changedPlayers.map(player => player.name),
    labels
  }
}
