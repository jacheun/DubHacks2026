import seed from './demo-data.json'
import { createDemoApi } from './demo-api'

export const DEMO_MODE = import.meta.env.VITE_USE_LIVE_API !== 'true'
let demoClient
export function apiFetch(url, options) {
  if (!DEMO_MODE) return globalThis.fetch(url, options)
  demoClient ??= createDemoApi(seed, globalThis.localStorage)
  return demoClient(url, options)
}

export async function readApiJson(response) {
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    throw new Error(`API routing failed (HTTP ${response.status}). Check the deployed API proxy and backend URL, then redeploy.`)
  }
  return response.json()
}
