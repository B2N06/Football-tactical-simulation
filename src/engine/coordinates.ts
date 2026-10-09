import type { Vec2 } from '../types'

export function normalizeStatsBomb(point: [number, number], flip = false): Vec2 {
  return normalizeCoordinate({ x: point?.[0], y: point?.[1] }, 120, 80, flip)
}

export function normalizeCoordinate(point: Vec2, sourceWidth: number, sourceHeight: number, flip = false): Vec2 {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) throw new Error('坐标系尺寸必须为大于 0 的有限数字')
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error('坐标必须为有限数字')
  const result = { x: clamp(point.x * 105 / sourceWidth, 0, 105), y: clamp(point.y * 68 / sourceHeight, 0, 68) }
  return flip ? { x: 105 - result.x, y: 68 - result.y } : result
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
