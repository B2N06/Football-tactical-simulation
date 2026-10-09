import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../public/_worker.js'

afterEach(() => vi.unstubAllGlobals())
const request = (path, options = {}) => new Request(`https://football.mossnyx.xyz${path}`, { headers: { 'X-Auth-Token': 'test-token', 'CF-Connecting-IP': Math.random().toString() }, ...options })

describe('同源比赛数据代理', () => {
  it('静态资源交给 Pages，未知与任意目标路径不能转发', async () => {
    const assets = { fetch: vi.fn().mockResolvedValue(new Response('app')) }
    expect(await (await worker.fetch(request('/'), { ASSETS: assets })).text()).toBe('app')
    expect((await worker.fetch(request('/api/football-data/https://example.com'), {})).status).toBe(404)
    expect((await worker.fetch(request('/api/football-data/matches/1?url=x'), {})).status).toBe(400)
  })
  it('拒绝跨源与写请求，不向其他网站泄露Token', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect((await worker.fetch(request('/api/football-data/matches/1', { headers: { Origin: 'https://example.com', 'X-Auth-Token': 'key' } }), {})).status).toBe(403)
    expect((await worker.fetch(request('/api/football-data/matches/1', { method: 'POST' }), {})).status).toBe(405)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('仅转发固定 v4 端点，响应禁止缓存', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const response = await worker.fetch(request('/api/football-data/matches/1'), {})
    expect(await response.json()).toEqual({ id: 1 })
    expect(fetcher.mock.calls[0][0]).toBe('https://api.football-data.org/v4/matches/1')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
