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
  it('拒绝非有限坐标和球场尺寸，防止 NaN 进入数据模型', () => {
    expect(() => normalizeStatsBomb([NaN, 40])).toThrow('有限数字')
    expect(() => normalizeCoordinate({ x: 1, y: 1 }, Infinity, 68)).toThrow('有限数字')
    expect(() => normalizeCoordinate({ x: Infinity, y: 1 }, 105, 68)).toThrow('有限数字')
  })
})
