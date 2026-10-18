import { useCallback, useEffect, useRef, useState } from 'react'
import IssueMap from './components/IssueMap'
import './App.css'

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

  const [issues, setIssues] = useState([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState(createFilters)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [focusedIssue, setFocusedIssue] = useState(null)
  const [mapView, setMapView] = useState('Satellite')
  const dialogRef = useRef(null)
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [scanBounds, setScanBounds] = useState(null)
  const [autoScan, setAutoScan] = useState(true)
  const scanRequest = useRef(0)
  const [scanId, setScanId] = useState(null)
  const [scanLimit, setScanLimit] = useState(10)
  const [analysisMessage, setAnalysisMessage] = useState('')
  const handleMapBoundsChange = useCallback(bounds => {
    setScanBounds(previous => previous && previous.every((value, index) => value === bounds[index]) ? previous : bounds)
  }, [])


  async function loadIssues() {
    const response = await fetch('/api/issues')
    if (!response.ok) throw new Error('Could not load issues. Check the backend is running.')
    setIssues(await response.json())
  }

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/issues', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Could not load issues. Check the backend is running.')
        return response.json()
      })
      .then(setIssues)
      .catch(error => { if (error.name !== 'AbortError') setApiError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  const scanArea = useCallback(async (event) => {
    event?.preventDefault()
    if (!scanBounds) return
    const request = ++scanRequest.current
    setScanId(null)
    setAnalyzing(true)
    setApiError('')
    setAnalysisMessage('Finding Mapillary imagery in this area…')
    try {
      const response = await fetch('/api/scans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox: scanBounds, limit: scanLimit }),
      })
      const data = await response.json()
      if (request !== scanRequest.current) return
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not start scan.')
      setScanId(data.id)
    } catch (error) {
      if (request === scanRequest.current) { setApiError(error.message); setAnalyzing(false) }
    }
  }, [scanBounds, scanLimit])

  useEffect(() => {
    if (!autoScan || !scanBounds) return
    const timer = setTimeout(() => { scanArea() }, 900)
    return () => clearTimeout(timer)
  }, [autoScan, scanBounds, scanArea])

  useEffect(() => {
    if (!scanId) return
    let stopped = false
    let timer
    async function poll() {
      try {
        const response = await fetch(`/api/scans/${scanId}`)
        if (!response.ok) throw new Error('Could not check scan progress. Reload and retry.')
        const scan = await response.json()
        if (stopped) return
        await loadIssues()
        if (stopped) return
        if (scan.status === 'failed') {
          setApiError(scan.error)
          setAnalysisMessage('Scan stopped. Any saved candidates remain available.')
          setAnalyzing(false)
          setScanId(null)
          return
        }
        setAnalysisMessage(scan.status === 'discovering'
          ? 'Finding Mapillary imagery in this area…'
          : `${scan.processed}/${scan.total} images checked · ${scan.detections} pothole candidate(s) · ${scan.failed} failed · ${scan.skipped} already analyzed${scan.status === 'completed' ? ' · Scan complete' : ''}`)
        if (['completed', 'cancelled'].includes(scan.status)) {
          setAnalyzing(false)
          setScanId(null)
        } else timer = setTimeout(poll, 2000)
      } catch (error) {
        if (!stopped) { setApiError(error.message); setAnalyzing(false); setScanId(null) }
      }
    }
    poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [scanId])


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
    (!scanBounds || (Number.isFinite(issue.latitude) && Number.isFinite(issue.longitude) &&
      issue.longitude >= scanBounds[0] && issue.longitude <= scanBounds[2] &&
      issue.latitude >= scanBounds[1] && issue.latitude <= scanBounds[3])) &&
    filterCategories.every(({ key, property }) => !filters[key].length || filters[key].includes(issue[property])) &&
    (!hasCoordinates || (validCoordinates && calculateDistance(
      Number(coordinateFilter.latitude), Number(coordinateFilter.longitude), issue.latitude ?? NaN, issue.longitude ?? NaN
    ) <= Number(coordinateFilter.radius))) &&
    searchValues(issue).some(value => String(value).toLowerCase().includes(query))
  )
  const suggestions = query ? [...new Set(filteredIssues.flatMap(searchValues))]
    .filter(value => String(value).toLowerCase().includes(query)).slice(0, 8) : []

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
  async function updateReviewStatus(id, newStatus) {
    setApiError('')
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: newStatus }),
      })
      if (!response.ok) throw new Error('Review change could not be saved.')
      const saved = await response.json()
      setIssues(previous => previous.map(issue => issue.id === id ? saved : issue))
      setSelectedIssue(previous => previous?.id === id ? saved : previous)
    } catch (error) { setApiError(error.message) }
  }

  async function saveLocation(event) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setApiError('')
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(selectedIssue.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: Number(fields.get('latitude')), longitude: Number(fields.get('longitude')) }),
      })
      if (!response.ok) throw new Error('Could not save location.')
      const saved = await response.json()
      setIssues(previous => previous.map(issue => issue.id === saved.id ? saved : issue))
      setSelectedIssue(saved)
      setFocusedIssue(saved)
    } catch (error) { setApiError(error.message) }
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
      'Work Order Status', 'Confidence', 'Latitude', 'Longitude', 'Location Accuracy',
      'Mapillary Image ID', 'Model Version', 'Capture Timestamp (ms)'
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
      issue.workOrderStatus, issue.confidence, issue.latitude, issue.longitude, issue.locationAccuracy,
      issue.sourceImageId, issue.modelVersion, issue.capturedAt
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
        <form className="analysis-form" onSubmit={scanArea}>
          <span>Find potholes in the visible map area</span>
          <label><input type="checkbox" checked={autoScan} onChange={event => setAutoScan(event.target.checked)} /> Scan automatically as map moves</label>
          <label>Images per scan
            <select value={scanLimit} disabled={analyzing} onChange={event => setScanLimit(Number(event.target.value))}>
              {[5, 10, 20, 30].map(limit => <option key={limit} value={limit}>{limit}</option>)}
            </select>
          </label>
          <button disabled={!scanBounds}>{analyzing ? 'Scan current area instead' : 'Scan map area'}</button>
          <small>Pan or zoom, then pause to scan. Dashboard results follow the visible area; earlier issues stay saved.</small>
        </form>
        {loading && <p role="status">Loading issues…</p>}
        {apiError && <p role="alert">{apiError}</p>}
        {analysisMessage && <p role="status">{analysisMessage}</p>}

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
              issues={filteredIssues.filter(issue => Number.isFinite(issue.latitude) && Number.isFinite(issue.longitude))}
              focusedIssue={focusedIssue}
              onFocusIssue={focusOnIssue}
              onSelectIssue={setSelectedIssue}
              view={mapView}
              onBoundsChange={handleMapBoundsChange}
            />


            <div className="map-footer">
              <span>Approximate camera locations · Reviewer adjustments remain estimates</span>
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

                    <strong>{issue.priorityScore ?? 'Unassigned'}</strong>
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
                        width: `${issue.priorityScore ?? 'Unassigned'}%`
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

            {selectedIssue.imageUrl && (
              <div>
                <div className="evidence-image">
                  <img src={selectedIssue.imageUrl} alt="Mapillary evidence for review" />
                  <svg viewBox={`0 0 ${selectedIssue.imageWidth} ${selectedIssue.imageHeight}`} aria-label="Candidate defect bounding box">
                    <rect x={selectedIssue.bbox[0]} y={selectedIssue.bbox[1]}
                      width={selectedIssue.bbox[2] - selectedIssue.bbox[0]}
                      height={selectedIssue.bbox[3] - selectedIssue.bbox[1]}
                      fill="none" stroke="#ff3b30" strokeWidth="3" />
                  </svg>
                </div>
                <p>Model confidence: {(selectedIssue.confidence * 100).toFixed(1)}% · Location: {selectedIssue.locationAccuracy}</p>
                <a href={`https://www.mapillary.com/app/?pKey=${selectedIssue.sourceImageId}`} target="_blank" rel="noreferrer">View source on Mapillary</a>
                <p>Mapillary imagery · Review evidence before verifying.</p>
              </div>
            )}
            <hr />

            <p>{selectedIssue.description}</p>

            <div className="modal-details">
              <p>
                <strong>Priority:</strong> {selectedIssue.priority}
              </p>

              <p>
                <strong>Priority Score:</strong> {selectedIssue.priorityScore ?? 'Unassigned'}
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

            <form key={selectedIssue.id} onSubmit={saveLocation} className="analysis-form">
              <label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" required defaultValue={selectedIssue.latitude ?? ''} /></label>
              <label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" required defaultValue={selectedIssue.longitude ?? ''} /></label>
              <button>Save estimated location</button>
            </form>
            {apiError && <p role="alert">{apiError}</p>}
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
