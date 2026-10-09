import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchStatsBombOpenMatch } from '../providers/statsbomb'

const maxBytes = 75 * 1024 * 1024
const events = [
  { id: 'pass', type: { name: 'Pass' }, team: { id: 1, name: 'A' }, player: { id: 11, name: '甲' }, location: [30, 40], pass: { end_location: [60, 40] } },
  { id: 'pressure', type: { name: 'Pressure' }, team: { id: 2, name: 'B' }, player: { id: 21, name: '乙' }, location: [60, 40] }
]

function responseFor(input: string | URL | Request) {
  return String(input).includes('/events/') ? new Response(JSON.stringify(events)) : new Response(null, { status: 404 })
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('StatsBomb 在线下载限制和失败处理', () => {
  it('仅请求固定 GitHub 数据源，可选阵容和 360 数据 404 不影响必需事件导入', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => responseFor(input))
    vi.stubGlobal('fetch', fetchMock)
    const bundle = await fetchStatsBombOpenMatch('42')
    expect(bundle.events).toHaveLength(2)
    expect(bundle.frames).toEqual([])
    expect(fetchMock.mock.calls.map((call: [string | URL | Request]) => String(call[0]))).toEqual([
      'https://raw.githubusercontent.com/statsbomb/open-data/master/data/events/42.json',
      'https://raw.githubusercontent.com/statsbomb/open-data/master/data/lineups/42.json',
      'https://raw.githubusercontent.com/statsbomb/open-data/master/data/three-sixty/42.json'
    ])
    await expect(fetchStatsBombOpenMatch('../secret')).rejects.toThrow('比赛 ID 必须为数字')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('必需事件 404 明确失败，不能返回空比赛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await expect(fetchStatsBombOpenMatch('42')).rejects.toThrow('events/42.json · HTTP 404')
  })

  it('Content-Length 超过 75 MB 时在读取正文前失败', async () => {
    const text = vi.fn().mockResolvedValue(JSON.stringify(events))
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).includes('/events/') ? {
      ok: true, status: 200, headers: new Headers({ 'Content-Length': String(maxBytes + 1) }), body: null, text
    } as unknown as Response : responseFor(input)))
    await expect(fetchStatsBombOpenMatch('42')).rejects.toThrow('超过 75 MB 上限')
    expect(text).not.toHaveBeenCalled()
  })

  it('没有 Content-Length 时仍按实际流字节限制大小并终止请求', async () => {
    const releaseLock = vi.fn()
    const read = vi.fn().mockResolvedValue({ done: false, value: { byteLength: maxBytes + 1 } })
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).includes('/events/')) return responseFor(input)
      signal = init?.signal ?? undefined
      return { ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read, releaseLock }) } } as unknown as Response
    }))
    await expect(fetchStatsBombOpenMatch('42')).rejects.toThrow('超过 75 MB 上限')
    expect(read).toHaveBeenCalledTimes(1)
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(true)
  })

  it.each(['events', 'lineups', 'three-sixty'])('拒绝 %s 返回非数组 JSON，即使该数据类型可选', async (folder: string) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).includes(`/${folder}/`) ? new Response('{"unexpected":true}') : responseFor(input)))
    await expect(fetchStatsBombOpenMatch('42')).rejects.toThrow('必须是 JSON 数组')
  })

  it('连接未响应 30 秒后通过 AbortController 终止并提示超时', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).includes('/events/')) return Promise.resolve(responseFor(input))
      signal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    }))
    const assertion = expect(fetchStatsBombOpenMatch('42')).rejects.toThrow('下载超时：events/42.json（30 秒）')
    await vi.advanceTimersByTimeAsync(30000)
    await assertion
    expect(signal?.aborted).toBe(true)
  })

  it('响应已连接但流读取停滞时也受到 30 秒超时限制', async () => {
    vi.useFakeTimers()
    const releaseLock = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).includes('/events/')) return responseFor(input)
      const signal = init!.signal!
      const read = () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
      return { ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read, releaseLock }) } } as unknown as Response
    }))
    const assertion = expect(fetchStatsBombOpenMatch('42')).rejects.toThrow('下载超时')
    await vi.advanceTimersByTimeAsync(30000)
    await assertion
    expect(releaseLock).toHaveBeenCalledTimes(1)
  })

  it('Response.body 为 null 的环境可使用 text 解析有效数据', async () => {
    const text = vi.fn().mockResolvedValue(JSON.stringify(events))
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).includes('/events/') ? {
      ok: true, status: 200, headers: new Headers(), body: null, text
    } as unknown as Response : responseFor(input)))
    const bundle = await fetchStatsBombOpenMatch('42')
    expect(bundle.events).toHaveLength(2)
    expect(text).toHaveBeenCalledTimes(1)
  })

  it('无效 JSON 和可选端点非 404 错误不能被当成缺失数据忽略', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => String(input).includes('/events/') ? new Response('not-json') : responseFor(input))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchStatsBombOpenMatch('42')).rejects.toThrow('不是有效 JSON')
    fetchMock.mockImplementation(async (input: string | URL | Request) => String(input).includes('/lineups/') ? new Response(null, { status: 500 }) : responseFor(input))
    await expect(fetchStatsBombOpenMatch('42')).rejects.toThrow('lineups/42.json · HTTP 500')
  })
})
