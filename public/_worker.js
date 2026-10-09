const apiHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
}
const errorResponse = (message, status) => new Response(JSON.stringify({ error: message }), { status, headers: apiHeaders })
const requests = new Map()

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    if (!url.pathname.startsWith('/api/football-data/')) return errorResponse('接口不存在', 404)
    if (request.method !== 'GET') return errorResponse('只允许读取比赛数据', 405)
    const origin = request.headers.get('Origin')
    if (origin && origin !== url.origin) return errorResponse('只允许本站发起数据源请求', 403)
    const path = url.pathname.slice('/api/football-data/'.length)
    if (!(path === 'competitions' || /^matches\/\d{1,20}$/.test(path))) return errorResponse('只支持赛事列表和指定比赛', 404)
    if (url.search && !(path === 'competitions' && url.search === '?limit=1')) return errorResponse('不支持的查询参数', 400)
    const token = request.headers.get('X-Auth-Token')?.trim()
    if (!token || token.length > 512 || /[\r\n]/.test(token)) return errorResponse('请配置有效的数据源 Token', 401)
    const now = Date.now()
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
    const rate = requests.get(ip)
    if (rate && now - rate.time < 60_000 && rate.count >= 30) return errorResponse('请求过于频繁，请稍后重试', 429)
    requests.set(ip, rate && now - rate.time < 60_000 ? { time: rate.time, count: rate.count + 1 } : { time: now, count: 1 })
    if (requests.size > 5000) for (const [key, value] of requests) if (now - value.time > 60_000) requests.delete(key)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25_000)
    try {
      // Destination and path are fixed; user keys never become stored Worker secrets.
      const upstream = await fetch(`https://api.football-data.org/v4/${path}${url.search}`, {
        method: 'GET', headers: { 'X-Auth-Token': token, Accept: 'application/json' }, signal: controller.signal, redirect: 'error'
      })
      if (!upstream.ok) {
        const status = [401, 403, 404, 429].includes(upstream.status) ? upstream.status : 502
        return errorResponse(status === 429 ? '数据源限流，请稍后重试' : '数据源拒绝请求或暂时不可用', status)
      }
      const declared = Number(upstream.headers.get('Content-Length') ?? 0)
      if (declared > 8 * 1024 * 1024) return errorResponse('数据源响应超过容量限制', 502)
      const reader = upstream.body?.getReader()
      if (!reader) return errorResponse('数据源未返回内容', 502)
      const chunks = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 8 * 1024 * 1024) { await reader.cancel(); return errorResponse('数据源响应超过容量限制', 502) }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      const json = JSON.parse(new TextDecoder().decode(bytes))
      return new Response(JSON.stringify(json), { headers: apiHeaders })
    } catch { return errorResponse('数据源连接失败或超时，请稍后重试', 502) }
    finally { clearTimeout(timer) }
  }
}
