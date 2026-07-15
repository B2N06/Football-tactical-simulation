export class SeededRandom {
  private state: number
  constructor(seed: number) { this.state = seed >>> 0 || 0x9e3779b9 }
  next(): number {
    let t = this.state += 0x6d2b79f5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  pickWeighted<T>(items: Array<{ item: T; weight: number }>): T {
    const total = items.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0)
    if (total <= 0) return items[0].item
    let cursor = this.next() * total
    for (const entry of items) {
      cursor -= Math.max(0, entry.weight)
      if (cursor <= 0) return entry.item
    }
    return items.at(-1)!.item
  }
}
