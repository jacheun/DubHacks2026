import { useEffect, useRef, useState } from 'react'
import './App.css'

const initialIssues = [
  {
    id: 1,
    type: 'Pothole',
    location: 'Rainier Ave S',
    neighborhood: 'Rainier Valley',
    latitude: 47.5605,
    longitude: -122.2885,
    description: 'Deep surface failure spanning the northbound curb lane.',
    priority: 'Critical',
    priorityScore: 94,
    reviewId: 'REV-001',
    reviewStatus: 'Verified',
    workOrderId: 'WO-001',
    workOrderStatus: 'Crew Dispatched',
    x: 62,
    y: 54
  },
  {
    id: 2,
    type: 'Sidewalk Crack',
    location: '15th Ave NW',
    neighborhood: 'Ballard',
    latitude: 47.6687,
    longitude: -122.3767,
    description: 'Multiple connected cracks creating an uneven pedestrian path.',
    priority: 'High',
    priorityScore: 81,
    reviewId: 'REV-002',
    reviewStatus: 'Pending',
    workOrderId: null,
    workOrderStatus: 'Not Created',
    x: 30,
    y: 43
  },
  {
    id: 3,
    type: 'Damaged Curb Ramp',
    location: 'Lake City Way NE',
    neighborhood: 'Lake City',
    latitude: 47.7195,
    longitude: -122.2956,
    description: 'Visible curb ramp deterioration requiring inspection.',
    priority: 'High',
    priorityScore: 76,
    reviewId: 'REV-003',
    reviewStatus: 'Verified',
    workOrderId: 'WO-002',
    workOrderStatus: 'Assigned',
    x: 75,
    y: 28
  },
  {
    id: 4,
    type: 'Road Crack',
    location: 'University Way NE',
    neighborhood: 'University District',
    latitude: 47.6615,
    longitude: -122.3131,
    description: 'Longitudinal pavement cracking along the road surface.',
    priority: 'Medium',
    priorityScore: 64,
    reviewId: 'REV-004',
    reviewStatus: 'Pending',
    workOrderId: null,
    workOrderStatus: 'Not Created',
    x: 24,
    y: 70
  }
]

function calculateDistance(latitude, longitude, issueLatitude, issueLongitude) {
  const radians = value => value * Math.PI / 180
  const latitudeDifference = radians(issueLatitude - latitude)
  const longitudeDifference = radians(issueLongitude - longitude)
  const a = Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(issueLatitude)) *
    Math.sin(longitudeDifference / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)))
}

function App() {
  const [issues, setIssues] = useState(initialIssues)
  const [filter, setFilter] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState({
    severity:[],
    type: [],
    reviewStatus: [],
    workOrderStatus: [],
    neighborhood: []
  })

  // Coordinate search inputs
  const [coordinateFilter, setCoordinateFilter] = useState({
    latitude: '',
    longitude: '',
    radius: 2
  })
  const [severity, setSeverity] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [mapView, setMapView] = useState('Satellite')
  const dialogRef = useRef(null)

  useEffect(() => {
    if (selectedIssue && !dialogRef.current.open) {
      dialogRef.current.showModal()
    }
  }, [selectedIssue])

  // Filter Infrastructure Issues
  const filteredIssues = issues.filter((issue) => {

    // Severity
    const matchesSeverity =
      (severity === 'all' || issue.priority === severity) &&
      (filters.severity.length === 0 || filters.severity.includes(issue.priority))

    // Infrastructure type
    const matchesType =
      filters.type.length === 0 ||
      filters.type.includes(issue.type)

    // Review status
    const matchesReview =
      (filter === 'all' || issue.reviewStatus === filter) &&
      (filters.reviewStatus.length === 0 || filters.reviewStatus.includes(issue.reviewStatus))

    // Work order status
    const matchesWorkOrder =
      filters.workOrderStatus.length === 0 ||
      filters.workOrderStatus.includes(issue.workOrderStatus)

    // Neighborhood
    const matchesNeighborhood =
      filters.neighborhood.length === 0 ||
      filters.neighborhood.includes(issue.neighborhood)

    // Search bar
    const matchesSearch =
      issue.location.toLowerCase().includes(search.toLowerCase()) ||
      issue.type.toLowerCase().includes(search.toLowerCase()) ||
      issue.neighborhood.toLowerCase().includes(search.toLowerCase())

    // Coordinate radius filter
    let matchesCoordinates = true

    const hasLatitude = coordinateFilter.latitude.trim() !== ''
    const hasLongitude = coordinateFilter.longitude.trim() !== ''

    if (hasLatitude && hasLongitude) {
      const lat = Number(coordinateFilter.latitude)
      const lon = Number(coordinateFilter.longitude)
      const radius = Number(coordinateFilter.radius)

      const validCoordinates =
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180 &&
        Number.isFinite(radius) &&
        radius > 0

      if (validCoordinates) {
        const distance = calculateDistance(
          lat,
          lon,
          issue.latitude,
          issue.longitude
        )

        matchesCoordinates = distance <= radius
      } else {
        matchesCoordinates = false
      }
    } else if (hasLatitude || hasLongitude) {
      matchesCoordinates = false
    }

    return (
      matchesSeverity &&
      matchesType &&
      matchesReview &&
      matchesWorkOrder &&
      matchesNeighborhood &&
      matchesSearch &&
      matchesCoordinates
    )
  })


  const totalIssues = issues.length
  const pendingReviews = issues.filter(issue => issue.reviewStatus === 'Pending').length
  const criticalRepairs = issues.filter(issue => issue.priority === 'Critical').length
  const completedRepairs = issues.filter(issue => issue.workOrderStatus === 'Completed').length
  const recoveryRate = totalIssues ? (completedRepairs / totalIssues * 100).toFixed(1) : '0.0'

  // Update an issue's review status
  function updateReviewStatus(id, newStatus) {
    setIssues(previousIssues =>
      previousIssues.map(issue =>
        issue.id === id
          ? { ...issue, reviewStatus: newStatus }
          : issue
      )
    )

    setSelectedIssue(previous =>
      previous?.id === id
        ? { ...previous, reviewStatus: newStatus }
        : previous
    )
  }

  // Export report
  function exportReport() {
    const headers = [
      'Issue ID',
      'Type',
      'Location',
      'Priority',
      'Priority Score',
      'Review ID',
      'Review Status',
      'Work Order ID',
      'Work Order Status'
    ]

    const rows = filteredIssues.map(issue => [
      issue.id,
      issue.type,
      issue.location,
      issue.priority,
      issue.priorityScore,
      issue.reviewId,
      issue.reviewStatus,
      issue.workOrderId ?? '',
      issue.workOrderStatus
    ])

    const escapeCSV = value =>
      `"${String(value ?? '').replace(/"/g, '""')}"`

    const csv = [headers, ...rows]
      .map(row => row.map(escapeCSV).join(','))
      .join('\r\n')

    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8;'
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'groundwork-report.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="app">

      {/* NAVIGATION */}
      <nav className="navbar">
        <div className="brand">
          <h2>GroundWorkAI</h2>
          <span>INFRASTRUCTURE INTELLIGENCE</span>
        </div>

        <div className="sidebar-links">
          <a href="#dashboard">Overview <span aria-hidden="true">↗</span></a>
          <a href="#inspection-map">Inspection map</a>
          <a href="#priorities">Repair priorities</a>
          <a href="#issues">Issue reports</a>
        </div>
        <div className="nav-actions">


          <button
            className="export-button"
            onClick={exportReport}
          >
            ↓ Export Report
          </button>
        </div>
      </nav>

      {/* DASHBOARD */}
      <main id="dashboard" className="dashboard">

        {/* HEADER */}
        <div className="dashboard-header">
          <div>
            <p className="eyebrow">
              OPERATIONS · SEATTLE, WA
            </p>

            <h1>Road condition overview</h1>

            <p className="subtitle">
              AI-powered road and sidewalk inspection
              within Seattle city limits.
            </p>
          </div>

          <div className="dashboard-filters">
          <input
            type="search"
            aria-label="Search roads and issues"
            placeholder="Search a road or issue..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
            <button
              className="export-button"
              aria-expanded={filterOpen}
              aria-controls="advanced-filters"
              onClick={() => setFilterOpen(previous => !previous)}
            >
              Filters
            </button>
          </div>
        </div>

        {filterOpen && (
          <section id="advanced-filters" className="advanced-filters" aria-label="Advanced issue filters">
            <label>
              Severity
            <select
              aria-label="Filter by severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="all">All Severity</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
            </label>
            {[
              ['type', 'Issue type', 'type'],
              ['reviewStatus', 'Review status', 'reviewStatus'],
              ['workOrderStatus', 'Work order', 'workOrderStatus'],
              ['neighborhood', 'Neighborhood', 'neighborhood']
            ].map(([key, label, property]) => (
              <label key={key}>
                {label}
                <select
                  value={filters[key][0] ?? ''}
                  onChange={event => setFilters(previous => ({
                    ...previous,
                    [key]: event.target.value ? [event.target.value] : []
                  }))}
                >
                  <option value="">All</option>
                  {[...new Set(issues.map(issue => issue[property]))].map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            ))}
            {[
              ['latitude', 'Latitude', -90, 90],
              ['longitude', 'Longitude', -180, 180],
              ['radius', 'Radius (km)', 0.1, undefined]
            ].map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  step="any"
                  min={min}
                  max={max}
                  value={coordinateFilter[key]}
                  onChange={event => setCoordinateFilter(previous => ({
                    ...previous, [key]: event.target.value
                  }))}
                />
              </label>
            ))}
            <button onClick={() => {
              setFilters({ severity: [], type: [], reviewStatus: [], workOrderStatus: [], neighborhood: [] })
              setCoordinateFilter({ latitude: '', longitude: '', radius: 2 })
              setSeverity('all')
              setFilter('all')
              setSearch('')
            }}>Reset filters</button>
            <p>Enter both coordinates and a positive radius to search nearby issues.</p>
          </section>
        )}

        {/* STATISTICS */}
        <div className="stats-grid">

          <div className="stat-card">
            <p>TOTAL ISSUES</p>
            <h2>{totalIssues}</h2>
            <span>Detected infrastructure issues</span>
          </div>

          <div className="stat-card">
            <p>PENDING REVIEW</p>
            <h2>{pendingReviews}</h2>
            <span>Awaiting verification</span>
          </div>

          <div className="stat-card">
            <p>CRITICAL REPAIRS</p>
            <h2>{criticalRepairs}</h2>
            <span>Require priority inspection</span>
          </div>

          <div className="stat-card">
            <p>RECOVERY RATE</p>
            <h2>{recoveryRate}%</h2>
            <span>Issues with completed work orders</span>
          </div>

        </div>

        {/* MAIN CONTENT */}
        <div className="main-grid">

          {/* MAP */}
          <section id="inspection-map" className="map-container">

            <div className="map-overlay">
              <span className="map-label">
                ● DEMO MAP
              </span>

              <div className="map-controls">
                {['Satellite', 'Road', 'Risk'].map(view => (
                  <button
                    key={view}
                    aria-pressed={mapView === view}
                    className={mapView === view ? 'selected' : ''}
                    onClick={() => setMapView(view)}
                  >
                    {view}
                  </button>
                ))}
              </div>
            </div>

            <div className={`map-area ${mapView.toLowerCase()}`}>

              {filteredIssues.map(issue => (
                <button
                  key={issue.id}
                  className={`map-marker ${issue.priority.toLowerCase()}`}
                  style={{
                    left: `${issue.x}%`,
                    top: `${issue.y}%`
                  }}
                  onClick={() => setSelectedIssue(issue)}
                  title={issue.location}
                >
                  {issue.id}
                </button>
              ))}

            </div>

            <div className="map-footer">
              <span>Illustrative map · Not georeferenced</span>
              <span>{filteredIssues.length} visible issues</span>
            </div>

          </section>

          {/* REPAIR PRIORITY PANEL */}
          <aside id="priorities" className="priority-panel">

            <div className="priority-header">
              <h2>Repair priority</h2>
              <p>{filteredIssues.length} active detections</p>
            </div>

            <div className="priority-list">

              {[...filteredIssues]
                .sort((a, b) => b.priorityScore - a.priorityScore)
                .map(issue => (

                <button
                  className="priority-item"
                  key={issue.id}
                  onClick={() => setSelectedIssue(issue)}
                >

                  <span className="priority-title">
                    <span className="priority-location">
                      <span
                        className={`priority-dot ${issue.priority.toLowerCase()}`}
                      ></span>

                      <span className="priority-name">{issue.location}</span>
                    </span>

                    <strong>{issue.priorityScore}</strong>
                  </span>

                  <span className="issue-id">
                    ISSUE-{String(issue.id).padStart(3, '0')}
                  </span>

                  <span className="issue-description">
                    {issue.description}
                  </span>

                  <span className="status-row">
                    <span className="review-badge">
                      {issue.reviewStatus}
                    </span>

                    <span className="work-badge">
                      {issue.workOrderStatus}
                    </span>
                  </span>

                  <span className="progress-track">
                    <span
                      className={`progress-fill ${issue.priority.toLowerCase()}`}
                      style={{
                        width: `${issue.priorityScore}%`
                      }}
                    ></span>
                  </span>

                </button>
              ))}

              {filteredIssues.length === 0 && (
                <p className="empty-message">
                  No issues match your filters.
                </p>
              )}

            </div>

          </aside>

        </div>

        {/* DETECTED ISSUES SECTION */}
        <section id="issues" className="issues-section">

          <div className="section-header">
            <h2>Detected Issues</h2>

            <div className="filter-buttons">
              <button
                className={filter === 'all' ? 'active' : ''}
                onClick={() => setFilter('all')}
              >
                All Issues
              </button>

              <button
                className={filter === 'Pending' ? 'active' : ''}
                onClick={() => setFilter('Pending')}
              >
                Pending Review
              </button>

              <button
                className={filter === 'Verified' ? 'active' : ''}
                onClick={() => setFilter('Verified')}
              >
                Verified
              </button>
            </div>
          </div>

          <div className="issues-list">
            {filteredIssues.map(issue => (

              <button
                className="issue-card"
                key={issue.id}
                onClick={() => setSelectedIssue(issue)}
              >
                <span>
                  <strong className="issue-type">{issue.type}</strong>
                  <span className="issue-location">{issue.location}</span>
                  <small>{issue.reviewId}</small>
                </span>

                <span className="issue-meta">
                  <span className={`priority ${issue.priority.toLowerCase()}`}>
                    {issue.priority}
                  </span>

                  <span className="review-badge">
                    {issue.reviewStatus}
                  </span>

                  <span className="work-badge">
                    {issue.workOrderStatus}
                  </span>
                </span>
              </button>

            ))}

            {filteredIssues.length === 0 && (
              <p className="empty-message">
                No issues found.
              </p>
            )}
          </div>

        </section>

      </main>

      {/* ISSUE DETAILS MODAL */}
      {selectedIssue && (
        <dialog
          ref={dialogRef}
          className="modal"
          aria-labelledby="issue-dialog-title"
          onClose={() => setSelectedIssue(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              const bounds = event.currentTarget.getBoundingClientRect()
              if (event.clientX < bounds.left || event.clientX > bounds.right ||
                  event.clientY < bounds.top || event.clientY > bounds.bottom) {
                event.currentTarget.close()
              }
            }
          }}
        >
            <button
              className="close-button"
              aria-label="Close issue details"
              onClick={() => dialogRef.current.close()}
            >
              ×
            </button>

            <p className="eyebrow">INFRASTRUCTURE REPORT</p>

            <h2 id="issue-dialog-title">{selectedIssue.type}</h2>
            <p>{selectedIssue.location}</p>

            <hr />

            <p>{selectedIssue.description}</p>

            <div className="modal-details">
              <p>
                <strong>Priority:</strong> {selectedIssue.priority}
              </p>

              <p>
                <strong>Priority Score:</strong> {selectedIssue.priorityScore}
              </p>

              <p>
                <strong>Review ID:</strong> {selectedIssue.reviewId}
              </p>

              <p>
                <strong>Work Order:</strong> {selectedIssue.workOrderId ?? 'N/A'}
              </p>

              <p>
                <strong>Work Order Status:</strong> {selectedIssue.workOrderStatus}
              </p>
            </div>

            <label htmlFor="review-status">
              Review Status
            </label>

            <select
              id="review-status"
              value={selectedIssue.reviewStatus}
              onChange={(e) =>
                updateReviewStatus(selectedIssue.id, e.target.value)
              }
            >
              <option value="Pending">Pending</option>
              <option value="Under Review">Under Review</option>
              <option value="Verified">Verified</option>
              <option value="Rejected">Rejected</option>
            </select>

        </dialog>
      )}

    </div>
  )
}

export default App
