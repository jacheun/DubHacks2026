// Same-origin API bridge for Vercel; API_BACKEND_URL is a server-only variable.
export default async function handler(request, response) {
  const origin = process.env.API_BACKEND_URL
  if (!origin) return response.status(503).json({ detail: 'Configure API_BACKEND_URL in Vercel and redeploy.' })
  try {
    const base = new URL(origin)
    if (base.protocol !== 'https:') throw new Error('HTTPS backend required')
    const incoming = new URL(request.url, 'https://frontend.local')
    if (!incoming.pathname.startsWith('/api/')) return response.status(404).end()
    const target = new URL(base.origin)
    target.pathname = incoming.pathname
    target.search = incoming.search
    const headers = {}
    if (request.headers['content-type']) headers['content-type'] = request.headers['content-type']
    const hasBody = !['GET', 'HEAD'].includes(request.method)
    const body = hasBody && request.body != null
      ? (typeof request.body === 'string' || Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body))
      : undefined
    const upstream = await fetch(target, {
      method: request.method, headers, body, signal: AbortSignal.timeout(20000), redirect: 'error',
    })
    response.status(upstream.status)
    response.setHeader('Cache-Control', 'no-store')
    const type = upstream.headers.get('content-type')
    if (type) response.setHeader('Content-Type', type)
    if (request.method === 'HEAD') return response.end()
    return response.send(Buffer.from(await upstream.arrayBuffer()))
  } catch {
    return response.status(502).json({ detail: 'Backend unavailable. Check the backend or tunnel and API_BACKEND_URL.' })
  }
}
