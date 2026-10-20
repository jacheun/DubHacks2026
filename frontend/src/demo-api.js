// Browser-only persistence for the saved-image demo. No backend requests.
export function createDemoApi(seed, storage) {
  const key = 'groundwork-saved-demo-v1'
  const reply = (body, status = 200) => Response.json(body, { status })
  function read() {
    const saved = storage.getItem(key)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed.issues) && Array.isArray(parsed.orders)) {
        // Repair labels from the initial seed without resetting user reviews or pins.
        parsed.issues = parsed.issues.map(issue => {
          const corrected = seed.issues.find(item => item.id === issue.id)
          return corrected && (issue.locationLabelVersion || 0) < (corrected.locationLabelVersion || 0)
            ? { ...issue, location: corrected.location, neighborhood: corrected.neighborhood, locationLabelVersion: corrected.locationLabelVersion }
            : issue
        })
        return parsed
      }
    }
    return { issues: structuredClone(seed.issues), orders: [] }
  }
  function present(order, state) {
    const issue = state.issues.find(item => item.id === order.issueId)
    return { ...issue, ...order }
  }
  return async function demoFetch(url, options = {}) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const state = read()
      const path = new URL(url, 'https://demo.local').pathname
      const method = options.method || 'GET'
      const body = options.body ? JSON.parse(options.body) : {}
      const headers = new Headers(options.headers)
      const role = headers.get('X-Groundwork-Role')
      const name = headers.get('X-Groundwork-Name')
      const save = () => storage.setItem(key, JSON.stringify(state))
      if (path === '/api/issues' && method === 'GET') return reply(state.issues)
      if (path.startsWith('/api/issues/') && method === 'PATCH') {
        const issue = state.issues.find(item => item.id === decodeURIComponent(path.split('/').pop()))
        if (!issue) return reply({ detail: 'Issue not found.' }, 404)
        if (body.reviewStatus != null && !['Pending', 'Under Review', 'Verified', 'Rejected'].includes(body.reviewStatus)) return reply({ detail: 'Invalid review status.' }, 422)
        if (body.priority != null && !['Unassigned', 'Low', 'Medium', 'High', 'Critical'].includes(body.priority)) return reply({ detail: 'Invalid priority.' }, 422)
        if (body.priorityScore != null && (!Number.isFinite(body.priorityScore) || body.priorityScore < 0 || body.priorityScore > 100)) return reply({ detail: 'Invalid priority score.' }, 422)
        if ((body.latitude != null) !== (body.longitude != null)) return reply({ detail: 'Provide both coordinates.' }, 422)
        if (body.latitude != null && (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) || Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180)) return reply({ detail: 'Invalid coordinates.' }, 422)
        for (const field of ['reviewStatus', 'priority', 'priorityScore', 'latitude', 'longitude']) {
          if (body[field] != null) issue[field] = body[field]
        }
        if (body.latitude != null) issue.locationAccuracy = 'reviewer_adjusted'
        save()
        return reply(issue)
      }
      if (path === '/api/work-orders' && method === 'GET') return reply(state.orders.map(order => present(order, state)))
      if (path === '/api/work-orders' && method === 'POST') {
        if (role !== 'coordinator' || !name) return reply({ detail: 'Only a coordinator can create a work order.' }, 403)
        const issue = state.issues.find(item => item.id === body.issueId)
        if (!issue) return reply({ detail: 'Issue not found.' }, 404)
        if (issue.reviewStatus !== 'Verified') return reply({ detail: 'Verify the issue first.' }, 409)
        if (issue.workOrderId) return reply({ detail: 'This issue already has a work order.' }, 409)
        if (!body.assignedTo?.trim()) return reply({ detail: 'Choose a crew member.' }, 422)
        const order = { id: `WO-${String(state.orders.length + 1).padStart(3, '0')}`, issueId: issue.id,
          assignedTo: body.assignedTo.trim(), notes: String(body.notes || '').slice(0, 500),
          status: 'Open', createdBy: name, createdAt: new Date().toISOString() }
        issue.workOrderId = order.id
        issue.workOrderStatus = order.status
        state.orders.push(order)
        save()
        return reply(present(order, state), 201)
      }
      if (path.startsWith('/api/work-orders/') && method === 'PATCH') {
        const order = state.orders.find(item => item.id === decodeURIComponent(path.split('/').pop()))
        if (!order) return reply({ detail: 'Work order not found.' }, 404)
        if (!['coordinator', 'crew'].includes(role) || (role === 'crew' && name !== order.assignedTo)) return reply({ detail: 'You cannot update this work order.' }, 403)
        if (!['Open', 'In Progress', 'Completed'].includes(body.status)) return reply({ detail: 'Invalid work order status.' }, 422)
        order.status = body.status
        const issue = state.issues.find(item => item.id === order.issueId)
        if (issue) issue.workOrderStatus = order.status
        save()
        return reply(present(order, state))
      }
      if (path === '/api/scans' && method === 'GET') return reply(null)
      return reply({ detail: 'Live scanning is disabled in the saved-image demo.' }, 409)
    } catch {
      return reply({ detail: 'Could not save demo changes. Allow browser storage and retry.' }, 500)
    }
  }
}
