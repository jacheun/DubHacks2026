export async function readApiJson(response) {
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    throw new Error(`API routing failed (HTTP ${response.status}). Check the deployed API proxy and backend URL, then redeploy.`)
  }
  return response.json()
}
