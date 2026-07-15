import type { PlayerTacticalProfile, TacticalScenario, TeamSide, Vec2 } from '../types'

const homeFormation: Array<[string, string, Vec2]> = [
  ['1', '门将', { x: 6, y: 34 }], ['2', '右后卫', { x: 23, y: 58 }], ['4', '中后卫', { x: 19, y: 41 }],
  ['5', '中后卫', { x: 19, y: 27 }], ['3', '左后卫', { x: 23, y: 10 }], ['6', '后腰', { x: 36, y: 34 }],
  ['8', '中前卫', { x: 49, y: 44 }], ['10', '前腰', { x: 59, y: 30 }], ['7', '右边锋', { x: 64, y: 59 }],
  ['11', '左边锋', { x: 66, y: 9 }], ['9', '中锋', { x: 77, y: 34 }]
]

const awayFormation: Array<[string, string, Vec2]> = [
  ['1', '门将', { x: 99, y: 34 }], ['2', '右后卫', { x: 82, y: 10 }], ['4', '中后卫', { x: 85, y: 27 }],
  ['5', '中后卫', { x: 85, y: 41 }], ['3', '左后卫', { x: 82, y: 58 }], ['6', '后腰', { x: 70, y: 34 }],
  ['8', '中前卫', { x: 60, y: 26 }], ['10', '中前卫', { x: 59, y: 44 }], ['7', '右边锋', { x: 42, y: 9 }],
  ['11', '左边锋', { x: 42, y: 59 }], ['9', '中锋', { x: 31, y: 34 }]
]

function makePlayer(side: TeamSide, entry: [string, string, Vec2], index: number): PlayerTacticalProfile {
  const [number, position, anchor] = entry
  const attacker = ['中锋', '边锋', '前腰'].some(label => position.includes(label))
  const defender = position.includes('后卫') || position === '后腰'
  return {
    playerId: `${side}-${number}`,
    name: `${side === 'home' ? '海港' : '城南'} ${position}`,
    shirtNumber: Number(number), side, position,
    role: position,
    duty: attacker ? '进攻' : defender ? '防守' : '支援',
    anchor, runPattern: attacker ? (position.includes('边锋') ? '内切' : '前插') : defender ? '保持位置' : '自由跑位',
    passRisk: 46 + (index % 4) * 5, passForward: 55 + (index % 3) * 7, passDirectness: 42 + (index % 5) * 4,
    shootTendency: attacker ? 67 : 22, carryTendency: position.includes('边锋') ? 73 : 45,
    pressIntensity: defender ? 64 : 58, marking: defender ? 72 : 50,
    attributes: {
      passing: 65 + (index % 4) * 4, firstTouch: 66 + (index % 3) * 4, dribbling: attacker ? 76 : 61,
      shooting: attacker ? 75 : 52, pace: position.includes('边') ? 82 : 68, stamina: 72,
      decisions: 68 + (index % 3) * 3, vision: position.includes('中') ? 75 : 65
    }, confidence: 'modelled-high'
  }
}

export function createDemoScenario(): TacticalScenario {
  return {
    id: 'demo-building-from-back',
    name: '后场组织 · 4-3-3 对 4-3-3',
    startingBall: { x: 18, y: 34 }, possession: 'home',
    home: homeFormation.map((entry, index) => makePlayer('home', entry, index)),
    away: awayFormation.map((entry, index) => makePlayer('away', entry, index)),
    homeTactics: { width: 66, depth: 58, defensiveLine: 52, pressing: 62, transitionSpeed: 57, buildUp: '短传组织', focus: '均衡' },
    awayTactics: { width: 58, depth: 54, defensiveLine: 62, pressing: 70, transitionSpeed: 64, buildUp: '混合推进', focus: '均衡' },
    seed: 20260715, iterations: 1200, maxActions: 10
  }
}
