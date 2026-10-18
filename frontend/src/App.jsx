import { useEffect, useRef, useState } from 'react'
import IssueMap from './components/IssueMap'
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

const filterCategories = [
  { key: 'neighborhood', label: 'Location', property: 'neighborhood' },
  { key: 'priority', label: 'Repair Priority', property: 'priority' },
  { key: 'type', label: 'Issue Type', property: 'type' },
  { key: 'reviewStatus', label: 'Review Status', property: 'reviewStatus' },
  { key: 'workOrderStatus', label: 'Work Order Status', property: 'workOrderStatus' },
]

function createFilters() {
  return { neighborhood: [], priority: [], type: [], reviewStatus: [], workOrderStatus: [],
    coordinates: { latitude: '', longitude: '', radius: '2' } }
}

function searchValues(issue) {
  return [issue.location, issue.neighborhood, issue.type, String(issue.id),
    `ISSUE-${String(issue.id).padStart(3, '0')}`, issue.reviewId, issue.workOrderId].filter(Boolean)
}

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
  const [activeSection, setActiveSection] = useState('inspection-map')

  useEffect(() => {
    const sections = ['inspection-map', 'priorities', 'issues']
    let frame = 0
    function updateSection() {
      const threshold = window.innerHeight * 0.3
      let current = sections[0]
      for (const id of sections) {
        const section = document.getElementById(id)
        if (section && section.getBoundingClientRect().top <= threshold) current = id
      }
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        current = sections[sections.length - 1]
      }
      setActiveSection(current)
    }
    function onScroll() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateSection)
    }
    updateSection()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const [issues, setIssues] = useState(initialIssues)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState(createFilters)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [focusedIssue, setFocusedIssue] = useState(null)
  const [mapView, setMapView] = useState('Satellite')
  const dialogRef = useRef(null)

  useEffect(() => {
    if (selectedIssue && !dialogRef.current.open) {
      dialogRef.current.showModal()
    }
  }, [selectedIssue])

  const coordinateFilter = filters.coordinates
  const hasCoordinates = coordinateFilter.latitude.trim() !== '' || coordinateFilter.longitude.trim() !== ''
  const validCoordinates = coordinateFilter.latitude.trim() !== '' && coordinateFilter.longitude.trim() !== '' &&
    Number.isFinite(Number(coordinateFilter.latitude)) && Math.abs(Number(coordinateFilter.latitude)) <= 90 &&
    Number.isFinite(Number(coordinateFilter.longitude)) && Math.abs(Number(coordinateFilter.longitude)) <= 180 &&
    Number.isFinite(Number(coordinateFilter.radius)) && Number(coordinateFilter.radius) > 0
  const coordinateError = hasCoordinates && !validCoordinates
  const activeFilterCount = filterCategories.reduce((count, { key }) => count + filters[key].length, 0) + Number(hasCoordinates)
  const query = search.trim().toLowerCase()
  const filteredIssues = issues.filter(issue =>
    filterCategories.every(({ key, property }) => !filters[key].length || filters[key].includes(issue[property])) &&
    (!hasCoordinates || (validCoordinates && calculateDistance(
      Number(coordinateFilter.latitude), Number(coordinateFilter.longitude), issue.latitude, issue.longitude
    ) <= Number(coordinateFilter.radius))) &&
    searchValues(issue).some(value => value.toLowerCase().includes(query))
  )
  const suggestions = query ? [...new Set(filteredIssues.flatMap(searchValues))]
    .filter(value => value.toLowerCase().includes(query)).slice(0, 8) : []

  function toggleFilter(key, value) {
    setFilters(previous => ({ ...previous, [key]: previous[key].includes(value)
      ? previous[key].filter(item => item !== value) : [...previous[key], value] }))
  }

  function focusOnIssue(issue) {
    setFocusedIssue({ ...issue })
    document.getElementById('inspection-map')?.scrollIntoView({
      behavior: 'smooth', block: 'center'
    })
  }

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
    <div className="app" data-theme="sage">

      {/* NAVIGATION */}
      <nav className="navbar">
        <div className="brand">
          <h2>GroundWorkAI</h2>

        </div>

        <div className="sidebar-links">
          <a href="#inspection-map" aria-current={activeSection === 'inspection-map' ? 'location' : undefined}>Inspection Map</a>
          <a href="#priorities" aria-current={activeSection === 'priorities' ? 'location' : undefined}>Repair Priorities</a>
          <a href="#issues" aria-current={activeSection === 'issues' ? 'location' : undefined}>Issue Reports</a>
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

            <h1>Road Condition Overview</h1>

            <p className="subtitle">
              AI-Powered Road and Sidewalk Inspection
              Within Seattle City Limits
            </p>
          </div>

          <div className="dashboard-filters">
            <div className="universal-search" onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false)
            }}>
              <div className="search-input-wrap">
                <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m16 16 4.5 4.5" />
                </svg>
                <input id="issue-search" type="search" placeholder="Search roads, places, types, IDs…"
                  aria-label="Search roads, neighborhoods, types, or IDs"
                  value={search} autoComplete="off" aria-controls="search-suggestions"
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={event => { if (event.key === 'Escape') setSearchOpen(false) }}
                  onChange={event => { setSearch(event.target.value); setSearchOpen(true) }} />
                {search && <button className="clear-search" aria-label="Clear search" onClick={() => {
                  setSearch(''); document.getElementById('issue-search').focus()
                }}>×</button>}
              </div>
              {searchOpen && query && (
                <div id="search-suggestions" className="search-suggestions" aria-label="Matching search suggestions">
                  {suggestions.length ? <ul>{suggestions.map(value => (
                    <li key={value}><button onClick={() => { setSearch(value); setSearchOpen(false) }}>{value}</button></li>
                  ))}</ul> : <p>No matches with the current filters.</p>}
                </div>
              )}
            </div>
            <button className="export-button" aria-expanded={filterOpen} aria-controls="issue-filters"
              onClick={() => setFilterOpen(previous => !previous)}>
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          </div>
        </div>

        <div className={`results-layout${filterOpen ? ' filters-open' : ''}`}>
          {filterOpen && (
            <aside id="issue-filters" className="filter-sidebar" aria-label="Issue filters">
              <div className="filter-sidebar-header">
                <h2>Filters <span>{activeFilterCount}</span></h2>
                <button onClick={() => setFilters(createFilters())} disabled={!activeFilterCount}>Clear All</button>
              </div>
              {filterCategories.map(({ key, label, property }) => (
                <details key={key} className="filter-category" open>
                  <summary>{label}{filters[key].length > 0 && <span>{filters[key].length}</span>}</summary>
                  <fieldset>
                    <legend className="sr-only">{label}</legend>
                    {(key === 'priority' ? ['Critical', 'High', 'Medium', 'Low'] :
                      [...new Set(issues.map(issue => issue[property]))].sort()).map(value => (
                      <label className="filter-checkbox" key={value}>
                        <input type="checkbox" checked={filters[key].includes(value)} onChange={() => toggleFilter(key, value)} />
                        <span>{value}</span>
                        <small>{issues.filter(issue => issue[property] === value).length}</small>
                      </label>
                    ))}
                  </fieldset>
                  {key === 'neighborhood' && (
                    <div className="coordinate-fields">
                      <p>Search near coordinates</p>
                      {[
                        ['latitude', 'Latitude', -90, 90], ['longitude', 'Longitude', -180, 180],
                        ['radius', 'Radius (km)', 0.1, undefined]
                      ].map(([key, label, min, max]) => (
                        <label key={key}>{label}
                          <input type="number" step="any" min={min} max={max} value={coordinateFilter[key]}
                            aria-describedby="coordinate-help" aria-invalid={coordinateError || undefined}
                            onChange={event => setFilters(previous => ({ ...previous,
                              coordinates: { ...previous.coordinates, [key]: event.target.value }
                            }))} />
                        </label>
                      ))}
                      <p id="coordinate-help" className={coordinateError ? 'filter-error' : ''}>
                        {coordinateError ? 'Enter latitude (−90 to 90), longitude (−180 to 180), and a radius greater than 0.' :
                          'Enter both coordinates and a positive radius in km. Coordinates count as one filter.'}
                      </p>
                    </div>
                  )}
                </details>
              ))}
            </aside>
          )}
          <div className="results-content">
        {/* MAIN CONTENT */}
        <div className="main-grid">

          {/* MAP */}
          <section id="inspection-map" className="map-container">

            <div className="map-overlay">
              <span className="map-label">
                ● SEATTLE ISSUE MAP
              </span>

              <div className="map-controls">
                {['Satellite', 'Road'].map(view => (
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

            
          {/* INTERACTIVE MAP */}
            <IssueMap
              issues={filteredIssues}
              focusedIssue={focusedIssue}
              onFocusIssue={focusOnIssue}
              onSelectIssue={setSelectedIssue}
              view={mapView}
            />


            <div className="map-footer">
              <span>Issue locations · Seattle, WA</span>
              <span>{filteredIssues.length} visible issues</span>
            </div>

          </section>

          {/* REPAIR PRIORITY PANEL */}
          <aside id="priorities" className="priority-panel">

            <div className="priority-header">
              <h2>Repair Priority</h2>
              <p>{filteredIssues.length} active detections</p>
            </div>

            <div className="priority-list">

              {[...filteredIssues]
                .sort((a, b) => b.priorityScore - a.priorityScore)
                .map(issue => (

                <button
                  className="priority-item"
                  key={issue.id}
                  onClick={() => focusOnIssue(issue)}
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

            <span>{filteredIssues.length} results</span>
          </div>

          <div className="issues-list">
            {filteredIssues.map(issue => (

              <button
                className="issue-card"
                key={issue.id}
                onClick={() => focusOnIssue(issue)}
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

          </div>
        </div>
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
