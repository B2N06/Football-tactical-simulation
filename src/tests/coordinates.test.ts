import { describe, expect, it } from 'vitest'
import { normalizeCoordinate, normalizeStatsBomb } from '../engine/coordinates'

describe('坐标归一化', () => {
  it('将 StatsBomb 120×80 坐标转换为 105×68 米', () => {
    expect(normalizeStatsBomb([120, 80])).toEqual({ x: 105, y: 68 })
    expect(normalizeStatsBomb([60, 40])).toEqual({ x: 52.5, y: 34 })
  })
  it('支持进攻方向翻转并限制越界坐标', () => {
    expect(normalizeCoordinate({ x: 0, y: 0 }, 105, 68, true)).toEqual({ x: 105, y: 68 })
    expect(normalizeCoordinate({ x: 300, y: -4 }, 105, 68)).toEqual({ x: 105, y: 0 })
  })
  it('拒绝无效坐标系', () => expect(() => normalizeCoordinate({ x: 1, y: 1 }, 0, 68)).toThrow())
})
