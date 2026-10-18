import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../frontend/api/proxy.js'

function response() {
  return { code: 200, headers: {}, body: null,
    status(value) { this.code = value; return this },
    setHeader(key, value) { this.headers[key] = value },
    json(value) { this.body = value; return this },
    send(value) { this.body = value; return this },
    end() { return this },
  }
}

test('proxy requires configured backend', async () => {
  delete process.env.API_BACKEND_URL
  const res = response()
  await handler({url:'/api/issues', method:'GET', headers:{}}, res)
  assert.equal(res.code, 503)
})

test('proxy forwards JSON writes and query parameters without exposing secrets', async () => {
  process.env.API_BACKEND_URL = 'https://backend.example'
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url.href, 'https://backend.example/api/scans?check=1')
      assert.equal(options.method, 'POST')
      assert.deepEqual(JSON.parse(options.body), { limit: 5 })
      assert.equal(options.headers['content-type'], 'application/json')
      return new Response('{"id":"scan-1"}', {status:202, headers:{'content-type':'application/json'}})
    }
    const res=response()
    await handler({url:'/api/scans?check=1', method:'POST', headers:{'content-type':'application/json'}, body:{limit:5}}, res)
    assert.equal(res.code, 202)
    assert.equal(JSON.parse(res.body.toString()).id, 'scan-1')
    assert.equal(res.headers['Cache-Control'], 'no-store')
  } finally { globalThis.fetch=originalFetch }
})

test('proxy preserves binary evidence images', async () => {
  process.env.API_BACKEND_URL='https://backend.example'
  const originalFetch=globalThis.fetch
  try {
    globalThis.fetch=async () => new Response(new Uint8Array([255,216,255]), {headers:{'content-type':'image/jpeg'}})
    const res=response()
    await handler({url:'/api/images/123/original.jpg',method:'GET',headers:{}},res)
    assert.equal(res.headers['Content-Type'],'image/jpeg')
    assert.deepEqual([...res.body], [255,216,255])
  } finally { globalThis.fetch=originalFetch }
})

test('unreachable backend returns a useful error', async () => {
  process.env.API_BACKEND_URL='https://backend.example'
  const originalFetch=globalThis.fetch
  try {
    globalThis.fetch=async () => { throw new Error('private details') }
    const res=response()
    await handler({url:'/api/issues',method:'GET',headers:{}},res)
    assert.equal(res.code,502)
    assert.ok(!JSON.stringify(res.body).includes('private details'))
  } finally { globalThis.fetch=originalFetch }
})


test('explicit rewrite forwards nested scan status and removes routing parameter', async () => {
  process.env.API_BACKEND_URL='https://backend.example'
  const originalFetch=globalThis.fetch
  try {
    globalThis.fetch=async url => {
      assert.equal(url.href,'https://backend.example/api/scans/abc?check=1')
      return Response.json({id:'abc',status:'completed'})
    }
    const res=response()
    await handler({url:'/api/proxy?__backend_path=scans%2Fabc&check=1', query:{__backend_path:'scans/abc'}, method:'GET',headers:{}},res)
    assert.equal(res.code,200)
    assert.equal(JSON.parse(res.body.toString()).id,'abc')
  } finally {globalThis.fetch=originalFetch}
})
