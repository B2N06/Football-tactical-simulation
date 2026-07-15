import { describe, expect, it } from 'vitest'
import { createDemoScenario } from '../engine/demo'
import { getGoalkeepingAttributes, getPlayerInstructionPreset, getTacticalPositionGroup, validatePlayerInstructions } from '../engine/playerInstructions'

describe('位置专属球员指令', () => {
  it('门将不显示进攻职责或插上跑位', () => {
    const goalkeeper = createDemoScenario().home[0]
    const preset = getPlayerInstructionPreset(goalkeeper)

    expect(preset.group).toBe('goalkeeper')
    expect(preset.duties).toEqual(['防守', '支援'])
    expect(preset.runPatterns).toEqual(['保持位置'])
    expect(preset.duties).not.toContain('进攻')
    expect(preset.runPatterns).not.toContain('前插')
  })

  it('中后卫、边后卫、边锋和前锋得到不同跑位选项', () => {
    const scenario = createDemoScenario()
    const centreBack = getPlayerInstructionPreset(scenario.home.find(player => player.position === '中后卫')!)
    const fullBack = getPlayerInstructionPreset(scenario.home.find(player => player.position === '右后卫')!)
    const winger = getPlayerInstructionPreset(scenario.home.find(player => player.position === '右边锋')!)
    const striker = getPlayerInstructionPreset(scenario.home.find(player => player.position === '中锋')!)

    expect(centreBack.runPatterns).not.toContain('前插')
    expect(fullBack.runPatterns).toContain('套边')
    expect(winger.runPatterns).toContain('内切')
    expect(striker.runPatterns).not.toContain('套边')
  })

  it('可识别常见中文位置和英文位置缩写', () => {
    expect(getTacticalPositionGroup({ position: 'Goalkeeper', role: 'GK' })).toBe('goalkeeper')
    expect(getTacticalPositionGroup({ position: 'Right Back', role: 'RB' })).toBe('fullBack')
    expect(getTacticalPositionGroup({ position: 'Centre Back', role: 'CB' })).toBe('centralDefender')
    expect(getTacticalPositionGroup({ position: 'Defensive Midfield', role: 'DM' })).toBe('defensiveMidfield')
    expect(getTacticalPositionGroup({ position: 'Attacking Midfield', role: 'AM' })).toBe('attackingMidfield')
    expect(getTacticalPositionGroup({ position: 'Right Wing', role: 'RW' })).toBe('winger')
    expect(getTacticalPositionGroup({ position: 'Centre Forward', role: 'CF' })).toBe('striker')
    expect(getTacticalPositionGroup({ position: '中前卫', role: '全能中场' })).toBe('centralMidfield')
  })

  it('阻止不兼容的位置指令进入推演', () => {
    const goalkeeper = structuredClone(createDemoScenario().home[0])
    goalkeeper.duty = '进攻'
    expect(validatePlayerInstructions(goalkeeper)).toContain('不适用于门将专项')
    goalkeeper.duty = '防守'; goalkeeper.runPattern = '前插'
    expect(validatePlayerInstructions(goalkeeper)).toContain('不适用于门将专项')
  })

  it('旧数据缺少门将专项时能生成安全的默认值', () => {
    const goalkeeper = structuredClone(createDemoScenario().home[0])
    delete goalkeeper.goalkeeping
    const attributes = getGoalkeepingAttributes(goalkeeper)
    expect(Object.values(attributes).every(value => value >= 0 && value <= 100)).toBe(true)
    expect(attributes.distribution).toBe(Math.round((goalkeeper.attributes.passing + goalkeeper.attributes.vision) / 2))
  })
})
