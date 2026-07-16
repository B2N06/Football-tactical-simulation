import type { PlayerDuty, PlayerTacticalProfile, RunPattern } from '../types'

export type TacticalPositionGroup = 'goalkeeper' | 'centralDefender' | 'fullBack' | 'defensiveMidfield' | 'centralMidfield' | 'attackingMidfield' | 'winger' | 'striker' | 'generic'

export interface PlayerInstructionPreset {
  group: TacticalPositionGroup
  label: string
  description: string
  roles: string[]
  duties: PlayerDuty[]
  runPatterns: RunPattern[]
}

const presets: Record<TacticalPositionGroup, Omit<PlayerInstructionPreset, 'group'>> = {
  goalkeeper: {
    label: '门将专项', description: '门将只保留防守或支援职责，跑位固定在门将活动区；出击和出球由专项参数控制。',
    roles: ['门将', '传统门将', '出球门将', '清道夫门将'], duties: ['防守', '支援'], runPatterns: ['保持位置']
  },
  centralDefender: {
    label: '中后卫指令', description: '中后卫以防线位置、盯人和出球为核心，不提供常规插上或内切指令。',
    roles: ['中后卫', '出球中卫', '盯人中卫', '拖后中卫'], duties: ['防守', '支援'], runPatterns: ['保持位置', '回撤接应']
  },
  fullBack: {
    label: '边后卫指令', description: '边后卫可以保持防线、套边前插或内收协助中场。',
    roles: ['防守边后卫', '进攻边后卫', '内收边后卫', '翼卫'], duties: ['防守', '支援', '进攻'], runPatterns: ['保持位置', '前插', '回撤接应', '套边', '内切']
  },
  defensiveMidfield: {
    label: '后腰指令', description: '后腰负责保护中路、回撤接应和第一阶段组织，不提供边路套边。',
    roles: ['后腰', '防守型中场', '拖后组织核心', '抢球中场'], duties: ['防守', '支援'], runPatterns: ['保持位置', '回撤接应', '自由跑位']
  },
  centralMidfield: {
    label: '中场指令', description: '中场可在组织、覆盖与后插上之间调整。',
    roles: ['中前卫', '全能中场', '中场组织核心', '抢球中场'], duties: ['防守', '支援', '进攻'], runPatterns: ['保持位置', '前插', '回撤接应', '自由跑位']
  },
  attackingMidfield: {
    label: '前腰指令', description: '前腰主要在肋部和禁区前沿接应，可前插、回撤或自由寻找空间。',
    roles: ['前腰', '高级组织核心', '影子前锋', '自由人'], duties: ['支援', '进攻'], runPatterns: ['前插', '回撤接应', '内切', '自由跑位']
  },
  winger: {
    label: '边路指令', description: '边路球员可以拉开宽度、套边、内切或回撤接应。',
    roles: ['边锋', '内锋', '边路组织核心', '边前卫'], duties: ['支援', '进攻'], runPatterns: ['前插', '回撤接应', '套边', '内切', '自由跑位']
  },
  striker: {
    label: '前锋指令', description: '前锋可攻击身后、作为支点回撤，或自由移动牵制中卫。',
    roles: ['中锋', '突前前锋', '支点中锋', '抢点前锋', '伪九号'], duties: ['支援', '进攻'], runPatterns: ['保持位置', '前插', '回撤接应', '自由跑位']
  },
  generic: {
    label: '通用指令', description: '位置数据不足，暂时显示通用职责；完善球员位置后会自动切换专属选项。',
    roles: ['通用球员'], duties: ['防守', '支援', '进攻'], runPatterns: ['保持位置', '前插', '回撤接应', '套边', '内切', '自由跑位']
  }
}

export function getTacticalPositionGroup(player: Pick<PlayerTacticalProfile, 'position' | 'role'>): TacticalPositionGroup {
  const raw = `${player.position} ${player.role}`.toLowerCase()
  const compact = raw.replace(/[\s_/-]/g, '')
  const tokens = raw.split(/[\s_/-]+/).filter(Boolean)
  const hasCode = (...codes: string[]) => codes.some(code => tokens.includes(code) || compact === code)

  if (compact.includes('goalkeeper') || compact.includes('keeper') || compact.includes('门将') || hasCode('gk')) return 'goalkeeper'
  if (['rightback', 'leftback', 'wingback', '边后卫', '翼卫', '右后卫', '左后卫'].some(label => compact.includes(label)) || hasCode('rwb', 'lwb', 'rb', 'lb')) return 'fullBack'
  if (['centreback', 'centerback', '中后卫', '拖后中卫'].some(label => compact.includes(label)) || hasCode('cb')) return 'centralDefender'
  if (['defensivemid', 'holdingmid', '后腰', '防守型中场'].some(label => compact.includes(label)) || hasCode('cdm', 'dm')) return 'defensiveMidfield'
  if (['attackingmid', '前腰', '影子前锋'].some(label => compact.includes(label)) || hasCode('cam', 'am')) return 'attackingMidfield'
  if (['rightwing', 'leftwing', 'winger', '边锋', '边前卫', '内锋'].some(label => compact.includes(label)) || hasCode('rw', 'lw')) return 'winger'
  if (['striker', 'centreforward', 'centerforward', '中锋', '前锋'].some(label => compact.includes(label)) || hasCode('st', 'cf', 'fw')) return 'striker'
  if (['midfield', '中场', '中前卫'].some(label => compact.includes(label)) || hasCode('cm')) return 'centralMidfield'
  return 'generic'
}

export function getPlayerInstructionPreset(player: Pick<PlayerTacticalProfile, 'position' | 'role'>): PlayerInstructionPreset {
  const group = getTacticalPositionGroup(player)
  return { group, ...presets[group] }
}

export function getGoalkeepingAttributes(player: PlayerTacticalProfile): NonNullable<PlayerTacticalProfile['goalkeeping']> {
  return player.goalkeeping ?? {
    shotStopping: Math.round((player.attributes.firstTouch + player.attributes.decisions) / 2),
    handling: player.attributes.firstTouch,
    aerialReach: Math.round((player.attributes.pace + player.attributes.stamina) / 2),
    oneOnOnes: Math.round((player.attributes.decisions + player.attributes.pace) / 2),
    rushingOut: Math.round((player.pressIntensity + player.attributes.decisions) / 2),
    distribution: Math.round((player.attributes.passing + player.attributes.vision) / 2)
  }
}

export function validatePlayerInstructions(player: PlayerTacticalProfile): string | undefined {
  const preset = getPlayerInstructionPreset(player)
  if (!preset.duties.includes(player.duty)) return `${player.name} 的“${player.duty}”职责不适用于${preset.label}`
  if (!preset.runPatterns.includes(player.runPattern)) return `${player.name} 的“${player.runPattern}”跑位不适用于${preset.label}`
  return undefined
}
