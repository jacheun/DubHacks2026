import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import seed from '../frontend/src/demo-data.json' with { type: 'json' }
import { createDemoApi } from '../frontend/src/demo-api.js'

const storage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
const request = (method, body, role='reviewer', name='Maya Chen') => ({ method,
  headers: { 'X-Groundwork-Role':role, 'X-Groundwork-Name':name }, body:JSON.stringify(body) })

test('five saved real predictions each have a bundled evidence image', async () => {
  assert.equal(seed.issues.length,5)
  for (const issue of seed.issues) {
    assert.ok(issue.confidence >= .35)
    assert.equal(issue.reviewStatus,'Pending')
    assert.ok(existsSync(new URL('../frontend/public'+issue.imageUrl, import.meta.url)))
  }
  const api=createDemoApi(seed,storage())
  assert.equal((await (await api('/api/issues')).json()).length,5)
  assert.equal((await api('/api/scans',request('POST',{}))).status,409)
})

test('review, priority, and location changes persist across browser sessions', async () => {
  const saved=storage()
  const api=createDemoApi(seed,saved)
  const id=seed.issues[0].id
  await api('/api/issues/'+id,request('PATCH',{reviewStatus:'Verified',priority:'High',priorityScore:80,latitude:47.6,longitude:-122.3}))
  const reloaded=createDemoApi(seed,saved)
  let issue=(await (await reloaded('/api/issues')).json()).find(item=>item.id===id)
  assert.equal(issue.reviewStatus,'Verified')
  assert.equal(issue.priorityScore,80)
  assert.equal(issue.locationAccuracy,'reviewer_adjusted')
  await reloaded('/api/issues/'+id,request('PATCH',{priority:'Medium'}))
  issue=(await (await reloaded('/api/issues')).json()).find(item=>item.id===id)
  assert.equal(issue.priorityScore,80)
  assert.equal((await reloaded('/api/issues/'+id,request('PATCH',{priorityScore:101}))).status,422)
})

test('coordinator and crew work-order flow works without a backend', async () => {
  const api=createDemoApi(seed,storage())
  const id=seed.issues[0].id
  const body={issueId:id,assignedTo:'Alex Rivera',notes:'Inspect on site'}
  assert.equal((await api('/api/work-orders',request('POST',body,'coordinator','Jordan Hale'))).status,409)
  await api('/api/issues/'+id,request('PATCH',{reviewStatus:'Verified'}))
  assert.equal((await api('/api/work-orders',request('POST',body))).status,403)
  const response=await api('/api/work-orders',request('POST',body,'coordinator','Jordan Hale'))
  assert.equal(response.status,201)
  const order=await response.json()
  assert.equal((await api('/api/work-orders',request('POST',body,'coordinator','Jordan Hale'))).status,409)
  assert.equal((await api('/api/work-orders/'+order.id,request('PATCH',{status:'Completed'},'crew','Someone Else'))).status,403)
  await api('/api/work-orders/'+order.id,request('PATCH',{status:'Completed'},'crew','Alex Rivera'))
  const updated=(await (await api('/api/issues')).json()).find(item=>item.id===id)
  assert.equal(updated.workOrderStatus,'Completed')
})

test('corrected city labels migrate without losing user review, score, or adjusted pin', async () => {
  const saved=storage()
  const original={issues:structuredClone(seed.issues),orders:[]}
  const row=original.issues.find(issue=>issue.sourceImageId==='7666522790067752')
  Object.assign(row,{location:'Saved inspection 2',neighborhood:'Seattle',locationLabelVersion:1,
    reviewStatus:'Verified',priorityScore:75,latitude:40.715,longitude:-73.954,locationAccuracy:'reviewer_adjusted'})
  saved.setItem('groundwork-saved-demo-v1',JSON.stringify(original))
  const api=createDemoApi(seed,saved)
  const migrated=(await (await api('/api/issues')).json()).find(issue=>issue.id===row.id)
  assert.ok(migrated.location.includes('Brooklyn, NY'))
  assert.equal(migrated.reviewStatus,'Verified')
  assert.equal(migrated.priorityScore,75)
  assert.equal(migrated.latitude,40.715)
  assert.equal(migrated.locationAccuracy,'reviewer_adjusted')
})
