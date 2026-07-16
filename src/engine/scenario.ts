import type { TacticalScenario, TeamSide } from '../types'

export function getPlayerSide(scenario: TacticalScenario, playerId: string): TeamSide {
  if (scenario.home.some(player => player.playerId === playerId)) return 'home'
  if (scenario.away.some(player => player.playerId === playerId)) return 'away'
  throw new Error(`方案中不存在球员 ${playerId}`)
}
