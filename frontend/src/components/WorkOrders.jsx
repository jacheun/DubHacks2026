import { useState } from 'react'

const STATUSES = ['Open', 'In Progress', 'Completed']

function statusClass(status) {
  return `work-badge ${String(status).toLowerCase().replace(/\s+/g, '-')}`
}

function formatWhen(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function WorkOrders({ person, orders, error, focusId, updatingId, onUpdateStatus }) {
  const [scope, setScope] = useState(person.role === 'crew' ? 'mine' : 'all')
  const [selectedId, setSelectedId] = useState(focusId)
  const visible = orders.filter(order => scope === 'all' || order.assignedTo === person.name)
  const selected = visible.find(order => order.id === selectedId) || visible[0] || null
  const canUpdate = person.role === 'crew' || person.role === 'coordinator'

  return (
    <section className="work-orders" id="work-orders" aria-labelledby="work-orders-title">
      <div className="work-order-heading">
        <div>
          <p className="eyebrow">FIELD WORK</p>
          <h1 id="work-orders-title">Work Orders</h1>
          <p className="subtitle">{person.summary}</p>
        </div>
        <div className="map-controls" role="group" aria-label="Which work orders to show">
          <button type="button" aria-pressed={scope === 'mine'} className={scope === 'mine' ? 'selected' : ''}
            onClick={() => setScope('mine')}>Assigned to me</button>
          <button type="button" aria-pressed={scope === 'all'} className={scope === 'all' ? 'selected' : ''}
            onClick={() => setScope('all')}>All orders</button>
        </div>
      </div>

      {error && <p className="role-note" role="alert">{error}</p>}

      <div className="work-order-layout">
        <div className="work-order-list" aria-label="Work orders">
          {visible.map(order => (
            <button type="button" key={order.id} className="work-order-card"
              aria-pressed={selected?.id === order.id} onClick={() => setSelectedId(order.id)}>
              <span>{order.id}</span>
              <strong>{order.type}</strong>
              <span>{order.location}</span>
              <span>Assigned to {order.assignedTo}</span>
              <span className={statusClass(order.status)}>{order.status}</span>
            </button>
          ))}
          {visible.length === 0 && (
            <p className="empty-message">
              {scope === 'mine'
                ? 'Nothing is assigned to you yet.'
                : 'No work orders yet. A coordinator creates one from a verified issue.'}
            </p>
          )}
        </div>

        {selected && (
          <article className="work-order-detail" aria-live="polite">
            <p className="eyebrow">{selected.id}</p>
            <h2>{selected.type}</h2>
            <p>{selected.location}</p>
            {selected.imageUrl && (
              <div className="evidence-image">
                <img src={selected.imageUrl} alt="Mapillary evidence for this work order" />
                {selected.bbox && selected.imageWidth && selected.imageHeight && (
                  <svg viewBox={`0 0 ${selected.imageWidth} ${selected.imageHeight}`} aria-label="Candidate defect bounding box">
                    <rect x={selected.bbox[0]} y={selected.bbox[1]}
                      width={selected.bbox[2] - selected.bbox[0]}
                      height={selected.bbox[3] - selected.bbox[1]}
                      fill="none" stroke="#ff3b30" strokeWidth="3" />
                  </svg>
                )}
              </div>
            )}
            <p><strong>Status:</strong> <span className={statusClass(selected.status)}>{selected.status}</span></p>
            <p><strong>Assigned to:</strong> {selected.assignedTo}</p>
            <p><strong>Created by:</strong> {selected.createdBy}{selected.createdAt ? ` · ${formatWhen(selected.createdAt)}` : ''}</p>
            {selected.notes && <p><strong>Notes:</strong> {selected.notes}</p>}
            {Number.isFinite(selected.confidence) && (
              <p>Model confidence: {(selected.confidence * 100).toFixed(1)}%</p>
            )}
            {Number.isFinite(selected.latitude) && Number.isFinite(selected.longitude) && (
              <p>Estimated location: {selected.latitude}, {selected.longitude}</p>
            )}
            {selected.sourceImageId && (
              <a href={`https://www.mapillary.com/app/?pKey=${selected.sourceImageId}`} target="_blank" rel="noreferrer">
                View source on Mapillary
              </a>
            )}
            {canUpdate && (
              <div className="work-order-actions" role="group" aria-label="Update work order progress">
                {STATUSES.map(status => (
                  <button type="button" key={status} aria-pressed={selected.status === status}
                    disabled={updatingId === selected.id}
                    onClick={() => { if (selected.status !== status) onUpdateStatus(selected, status) }}>
                    {status}
                  </button>
                ))}
              </div>
            )}
          </article>
        )}
      </div>
    </section>
  )
}
