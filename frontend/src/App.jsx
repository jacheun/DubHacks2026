import { readApiJson, apiFetch as fetch, DEMO_MODE } from './api'
import { useCallback, useEffect, useRef, useState } from 'react'
import IssueMap from './components/IssueMap'
import WorkOrders from './components/WorkOrders'
import { CREW, PEOPLE, actorHeaders, loadPerson, savePerson } from './people'
import './App.css'

const filterCategories = [
  { key: 'priority', label: 'Repair Priority', property: 'priority' },
  { key: 'type', label: 'Issue Type', property: 'type' },
  { key: 'reviewStatus', label: 'Review Status', property: 'reviewStatus' },
  { key: 'workOrderStatus', label: 'Work Order Status', property: 'workOrderStatus' },
]

function createFilters() {
  return { zipCode: '', priority: [], type: [], reviewStatus: [], workOrderStatus: [] }
}

function searchValues(issue) {
  return [issue.location, issue.neighborhood, issue.type, issue.priority, issue.zipCode,
    issue.latitude, issue.longitude, `${issue.latitude}, ${issue.longitude}`, String(issue.id),
    `ISSUE-${String(issue.id).padStart(3, '0')}`, issue.reviewId, issue.workOrderId]
    .filter(value => value !== null && value !== undefined && value !== '')
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

function failureMessage(data, fallback) {
  return typeof data?.detail === 'string' ? data.detail : fallback
}

function workBadgeClass(status) {
  return `work-badge ${String(status).toLowerCase().replace(/\s+/g, '-')}`
}

function App() {
  const [person, setPerson] = useState(loadPerson)
  const [screen, setScreen] = useState(() => (loadPerson().role === 'crew' ? 'orders' : 'dashboard'))
  const [workOrders, setWorkOrders] = useState([])
  const [ordersError, setOrdersError] = useState('')
  const [orderFocus, setOrderFocus] = useState(null)
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [updatingOrderId, setUpdatingOrderId] = useState('')
  const [activeSection, setActiveSection] = useState('inspection-map')

  useEffect(() => {
    if (screen !== 'dashboard') return undefined
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
  }, [screen])

  const [issues, setIssues] = useState([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState(createFilters)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [savingMetadata, setSavingMetadata] = useState(false)
  const [metadataFeedback, setMetadataFeedback] = useState(null)
  const [focusedIssue, setFocusedIssue] = useState(null)
  const [mapView, setMapView] = useState('Satellite')
  const dialogRef = useRef(null)
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [scanBounds, setScanBounds] = useState(null)
  const [autoScan, setAutoScan] = useState(!DEMO_MODE)
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
    setIssues(await readApiJson(response))
  }

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/issues', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Could not load issues. Check the backend is running.')
        return readApiJson(response)
      })
      .then(setIssues)
      .catch(error => { if (error.name !== 'AbortError') setApiError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  const scanArea = useCallback(async (event) => {
    event?.preventDefault()
    if (DEMO_MODE || !scanBounds) return
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
      const data = await readApiJson(response)
      if (request !== scanRequest.current) return
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not start scan.')
      setScanId(data.id)
    } catch (error) {
      if (request === scanRequest.current) { setApiError(error.message); setAnalyzing(false) }
    }
  }, [scanBounds, scanLimit])

  useEffect(() => {
    if (DEMO_MODE || screen !== 'dashboard' || person.role === 'crew' || !autoScan || !scanBounds) return undefined
    const timer = setTimeout(() => { scanArea() }, 900)
    return () => clearTimeout(timer)
  }, [screen, person.role, autoScan, scanBounds, scanArea])

  useEffect(() => {
    let stopped = false
    let seen = ''
    async function load() {
      try {
        const response = await fetch('/api/work-orders', { headers: actorHeaders(person, false) })
        const data = await readApiJson(response)
        if (!response.ok) throw new Error(failureMessage(data, 'Could not load work orders.'))
        if (!Array.isArray(data)) throw new Error('Could not load work orders.')
        if (stopped) return
        setWorkOrders(data)
        setOrdersError('')
        const signature = data.map(order => `${order.id}:${order.status}`).join('|')
        if (signature === seen) return
        seen = signature
        const issuesResponse = await fetch('/api/issues')
        if (!issuesResponse.ok || stopped) return
        const nextIssues = await readApiJson(issuesResponse)
        if (!Array.isArray(nextIssues) || stopped) return
        setIssues(nextIssues)
        setSelectedIssue(previous => previous
          ? nextIssues.find(issue => issue.id === previous.id) ?? previous
          : previous)
      } catch (error) {
        if (!stopped) setOrdersError(error.message)
      }
    }
    load()
    const timer = setInterval(load, 4000)
    return () => { stopped = true; clearInterval(timer) }
  }, [person])

  useEffect(() => {
    if (!scanId) return
    let stopped = false
    let timer
    async function poll() {
      try {
        const response = await fetch(`/api/scans/${scanId}`)
        if (!response.ok) throw new Error('Could not check scan progress. Reload and retry.')
        const scan = await readApiJson(response)
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
          : `${scan.processed}/${scan.total} images checked · ${scan.detections} road-damage candidate(s) · ${scan.failed} failed · ${scan.skipped} already analyzed${scan.status === 'completed' ? ' · Scan complete' : ''}`)
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

  const zipQuery = filters.zipCode.trim()
  const activeFilterCount = filterCategories.reduce((count, { key }) => count + filters[key].length, 0) + Number(Boolean(zipQuery))
  const query = search.trim().toLowerCase()
  const filteredIssues = issues.filter(issue =>
    (DEMO_MODE || !scanBounds || (Number.isFinite(issue.latitude) && Number.isFinite(issue.longitude) &&
      issue.longitude >= scanBounds[0] && issue.longitude <= scanBounds[2] &&
      issue.latitude >= scanBounds[1] && issue.latitude <= scanBounds[3])) &&
    filterCategories.every(({ key, property }) => !filters[key].length || filters[key].includes(issue[property])) &&
    (!zipQuery || String(issue.zipCode ?? '').startsWith(zipQuery)) &&
    (searchValues(issue).some(value => String(value).toLowerCase().includes(query)) ||
      (() => {
        const pair = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/)
        return pair && Math.abs(Number(pair[1])) <= 90 && Math.abs(Number(pair[2])) <= 180 &&
          Number.isFinite(issue.latitude) && Number.isFinite(issue.longitude) &&
          calculateDistance(Number(pair[1]), Number(pair[2]), issue.latitude, issue.longitude) <= 2
      })())
  )
  const suggestions = query ? [...new Set(filteredIssues.flatMap(searchValues))]
    .filter(value => String(value).toLowerCase().includes(query)).slice(0, 8) : []

  function toggleFilter(key, value) {
    setFilters(previous => ({ ...previous, [key]: previous[key].includes(value)
      ? previous[key].filter(item => item !== value) : [...previous[key], value] }))
  }

  function choosePerson(next) {
    savePerson(next)
    setPerson(next)
    setScreen(next.role === 'crew' ? 'orders' : 'dashboard')
    setSelectedIssue(null)
    setApiError('')
    setOrdersError('')
  }

  function showDashboard(event, id) {
    if (screen === 'dashboard') return
    event.preventDefault()
    setScreen('dashboard')
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
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
      const saved = await readApiJson(response)
      setIssues(previous => previous.map(issue => issue.id === id ? saved : issue))
      setSelectedIssue(previous => previous?.id === id ? saved : previous)
    } catch (error) { setApiError(error.message) }
  }

  async function savePriority(event) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const score = String(fields.get('priorityScore') ?? '').trim()
    setApiError('')
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(selectedIssue.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: fields.get('priority'), ...(score !== '' ? { priorityScore: Number(score) } : {}) }),
      })
      const saved = await readApiJson(response)
      if (!response.ok) throw new Error(failureMessage(saved, 'Could not save priority.'))
      setIssues(previous => previous.map(issue => issue.id === saved.id ? saved : issue))
      setSelectedIssue(previous => previous?.id === saved.id ? saved : previous)
    } catch (error) { setApiError(error.message) }
  }

  async function saveLocation(event) {
    event.preventDefault()
    if (savingMetadata) return
    const fields = new FormData(event.currentTarget)
    const issueId = selectedIssue.id
    const priority = fields.get('priority')
    const payload = { priority }
    if (fields.get('latitude') !== '' || fields.get('longitude') !== '') {
      if (fields.get('latitude') === '' || fields.get('longitude') === '') {
        setMetadataFeedback({ issueId, error: true, message: 'Enter both latitude and longitude, or leave both blank.' })
        return
      }
      payload.latitude = Number(fields.get('latitude'))
      payload.longitude = Number(fields.get('longitude'))
    }
    setSavingMetadata(true)
    setMetadataFeedback(null)
    setApiError('')
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      })
      const saved = await readApiJson(response)
      if (!response.ok) throw new Error(failureMessage(saved, 'Could not save report metadata. Please retry.'))
      if (saved.priority !== priority) throw new Error('The backend did not save the priority. Restart the Python backend with the latest code, then retry.')
      setIssues(previous => previous.map(issue => issue.id === saved.id ? saved : issue))
      setSelectedIssue(current => current?.id === issueId ? saved : current)
      if (Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) setFocusedIssue(saved)
      setMetadataFeedback({ issueId, error: false, message: 'Report metadata saved successfully.' })
    } catch (error) {
      setMetadataFeedback({ issueId, error: true, message: error.name === 'TimeoutError'
        ? 'Save timed out. Reload the report to check whether it saved before retrying.' : error.message })
    } finally { setSavingMetadata(false) }
  }

  async function createWorkOrder(event) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setCreatingOrder(true)
    setApiError('')
    try {
      const response = await fetch('/api/work-orders', {
        method: 'POST',
        headers: actorHeaders(person),
        body: JSON.stringify({
          issueId: selectedIssue.id,
          notes: fields.get('notes') ?? '',
          assignedTo: fields.get('assignedTo'),
        }),
      })
      const saved = await readApiJson(response)
      if (!response.ok) throw new Error(failureMessage(saved, 'Could not create the work order.'))
      setWorkOrders(previous => [saved, ...previous.filter(order => order.id !== saved.id)])
      const apply = issue => issue.id === saved.issueId
        ? { ...issue, workOrderId: saved.id, workOrderStatus: saved.status }
        : issue
      setIssues(previous => previous.map(apply))
      setSelectedIssue(previous => previous ? apply(previous) : previous)
    } catch (error) {
      setApiError(error.message)
    } finally {
      setCreatingOrder(false)
    }
  }

  async function updateWorkOrderStatus(order, status) {
    setUpdatingOrderId(order.id)
    setOrdersError('')
    try {
      const response = await fetch(`/api/work-orders/${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        headers: actorHeaders(person),
        body: JSON.stringify({ status }),
      })
      const saved = await readApiJson(response)
      if (!response.ok) throw new Error(failureMessage(saved, 'Could not update the work order.'))
      setWorkOrders(previous => previous.map(item => item.id === saved.id ? saved : item))
      setIssues(previous => previous.map(issue => issue.id === saved.issueId
        ? { ...issue, workOrderStatus: saved.status }
        : issue))
      setSelectedIssue(previous => previous?.id === saved.issueId
        ? { ...previous, workOrderStatus: saved.status }
        : previous)
    } catch (error) {
      setOrdersError(error.message)
    } finally {
      setUpdatingOrderId('')
    }
  }

  // Export report
  function exportReport() {
    const headers = [
      'Issue ID',
      'Type',
      'ZIP Code',
      'Location',
      'Priority',
      'Review ID',
      'Review Status',
      'Work Order ID',
      'Work Order Status', 'Confidence', 'Latitude', 'Longitude', 'Location Accuracy',
      'Mapillary Image ID', 'Model Version', 'Capture Timestamp (ms)'
    ]

    const rows = filteredIssues.map(issue => [
      issue.id,
      issue.type,
      issue.zipCode,
      issue.location,
      issue.priority,
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

  const selectedOrder = selectedIssue
    ? workOrders.find(order => order.id === selectedIssue.workOrderId || order.issueId === selectedIssue.id)
    : null

  return (
    <div className="app" data-theme="sage">

      {/* NAVIGATION */}
      <nav className="navbar">
        <div className="brand">
          <h2>GroundWorkAI</h2>

        </div>

        <div className="person-switcher">
          <p className="eyebrow">Using the app as</p>
          <strong>{person.name}</strong>
          <span>{person.title}</span>
          <div role="group" aria-label="Choose who is using Groundwork">
            {PEOPLE.map(option => (
              <button type="button" key={option.id} aria-pressed={option.id === person.id}
                onClick={() => choosePerson(option)}>
                <span>{option.name}</span>
                <small>{option.title}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-links">
          {person.role !== 'crew' && (
            <>
              <a href="#inspection-map" onClick={event => showDashboard(event, 'inspection-map')}
                aria-current={screen === 'dashboard' && activeSection === 'inspection-map' ? 'location' : undefined}>Inspection Map</a>
              <a href="#priorities" onClick={event => showDashboard(event, 'priorities')}
                aria-current={screen === 'dashboard' && activeSection === 'priorities' ? 'location' : undefined}>Repair Priorities</a>
              <a href="#issues" onClick={event => showDashboard(event, 'issues')}
                aria-current={screen === 'dashboard' && activeSection === 'issues' ? 'location' : undefined}>Issue Reports</a>
            </>
          )}
          {person.role !== 'reviewer' && (
            <button type="button" aria-current={screen === 'orders' ? 'page' : undefined}
              onClick={() => setScreen('orders')}>Work Orders</button>
          )}
        </div>
        <div className="nav-actions">


          {screen === 'dashboard' && person.role !== 'crew' && (
            <button
              className="export-button"
              onClick={exportReport}
            >
              ↓ Export Report
            </button>
          )}
        </div>
      </nav>

      {/* DASHBOARD */}
      <main id="dashboard" className="dashboard">
        {screen === 'orders' ? (
          <WorkOrders
            key={`${person.id}:${orderFocus ?? ''}`}
            person={person}
            orders={workOrders}
            error={ordersError}
            focusId={orderFocus}
            updatingId={updatingOrderId}
            onUpdateStatus={updateWorkOrderStatus}
          />
        ) : (
        <>
        {DEMO_MODE ? (
          <section className="scan-console" aria-label="Saved-image demo">
            <div className="scan-toolbar">
              <div className="scan-heading"><div>
                <h2>Saved inspection demo</h2>
                <p>Five saved images with real YOLO crack predictions. No live imagery scanning.</p>
              </div></div>
              <span className="review-badge">5 saved detections</span>
            </div>
            <div className="scan-status-bar"><p role="status">Review decisions, priorities, and work orders are saved in this browser. Predictions require human verification.</p></div>
            {loading && <p role="status">Loading saved inspections…</p>}
            {apiError && <p role="alert">{apiError}</p>}
          </section>
        ) : (
          <>
        <section className="scan-console" aria-labelledby="scan-console-title" aria-busy={analyzing}>
          <form className="scan-toolbar" onSubmit={scanArea}>
            <div className="scan-heading">
              <span className="scan-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M7 12h10M12 7v10" />
                </svg>
              </span>
              <div>
                <h2 id="scan-console-title">Imagery scan</h2>
                <p>Find road damage in the current map view.</p>
              </div>
            </div>
            <div className="scan-toolbar-controls">
              <label className="scan-auto-toggle">
                <input type="checkbox" role="switch" checked={autoScan}
                  onChange={event => setAutoScan(event.target.checked)} />
                <span className="scan-toggle-track" aria-hidden="true" />
                <span>Auto scan</span>
              </label>
              <span className="scan-toolbar-divider" aria-hidden="true" />
              <label className="scan-batch-label" htmlFor="scan-batch-size">Batch size
                <select id="scan-batch-size" value={scanLimit} disabled={analyzing}
                  onChange={event => setScanLimit(Number(event.target.value))}>
                  {[5, 10, 20, 30].map(limit => <option key={limit} value={limit}>{limit} images</option>)}
                </select>
              </label>
              <button className="scan-submit" disabled={!scanBounds}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" />
                </svg>
                {analyzing ? 'Scan this area instead' : 'Scan map area'}
              </button>
            </div>
          </form>
          <div className={`scan-status-bar${apiError ? ' scan-status-error' : ''}`}>
            <span className={`scan-state${analyzing ? ' is-scanning' : ''}`}>
              <span className="scan-state-dot" aria-hidden="true" />
              {apiError ? 'Needs attention' : analyzing ? 'Scanning' : autoScan ? 'Auto scan on' : 'Manual mode'}
            </span>
            <p role={apiError ? 'alert' : 'status'}>
              {apiError || (loading ? 'Loading saved issues…' : analysisMessage) ||
                (autoScan ? 'Pan or zoom, then pause to scan. Earlier issues stay saved.' : 'Position the map, then select Scan map area.')}
            </p>
          </div>
        </section>

          </>
        )}

        {/* HEADER */}
        <div className="dashboard-header">
          <div>
            <p className="dashboard-location">{DEMO_MODE ? 'Seattle area, WA · Brooklyn, NY' : 'Seattle, WA'}</p>

            <h1>Road Condition Overview</h1>

            <p className="subtitle">
              AI-Powered Road and Sidewalk Inspection
              {DEMO_MODE ? 'Saved inspection examples' : 'Within Seattle City Limits'}
            </p>
            <p className="role-banner">{person.summary}</p>
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
                <input id="issue-search" type="search" placeholder="Search ZIP, priority, latitude, longitude…"
                  aria-label="Search reports by ZIP, priority, coordinates, roads, types, or IDs"
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
              <details className="filter-category" open>
                <summary>ZIP Code{zipQuery && <span>1</span>}</summary>
                <div className="coordinate-fields">
                  <label htmlFor="zip-filter">ZIP code
                    <input id="zip-filter" type="text" inputMode="numeric" placeholder="e.g. 98101"
                      value={filters.zipCode} onChange={event => setFilters(previous => ({ ...previous, zipCode: event.target.value }))} />
                  </label>
                  <p>Enter a full ZIP code or its first digits.</p>
                </div>
              </details>
              {filterCategories.map(({ key, label, property }) => (
                <details key={key} className="filter-category" open>
                  <summary>{label}{filters[key].length > 0 && <span>{filters[key].length}</span>}</summary>
                  <fieldset>
                    <legend className="sr-only">{label}</legend>
                    {(key === 'priority' ? ['Critical', 'Medium', 'Low', 'Unassigned'] :
                      [...new Set(issues.map(issue => issue[property]).filter(Boolean))].sort()).map(value => (
                      <label className="filter-checkbox" key={value}>
                        <input type="checkbox" checked={filters[key].includes(value)} onChange={() => toggleFilter(key, value)} />
                        <span>{value}</span>
                        <small>{issues.filter(issue => issue[property] === value).length}</small>
                      </label>
                    ))}
                  </fieldset>

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
                ● {DEMO_MODE ? 'SAVED INSPECTION MAP' : 'SEATTLE ISSUE MAP'}
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
              fitSavedImages={DEMO_MODE}
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
                .sort((a, b) => ({ Critical: 3, Medium: 2, Low: 1 }[b.priority] ?? 0) - ({ Critical: 3, Medium: 2, Low: 1 }[a.priority] ?? 0))
                .map(issue => (

                <button
                  className="priority-item"
                  key={issue.id}
                  onClick={() => { focusOnIssue(issue); setSelectedIssue(issue) }}
                >

                  <span className="priority-title">
                    <span className="priority-location">
                      <span
                        className={`priority-dot ${issue.priority.toLowerCase()}`}
                      ></span>

                      <span className="priority-name">{issue.location}</span>
                    </span>

                    <strong>{issue.priority}</strong>
                  </span>

                  <span className="issue-id">
                    ISSUE-{String(issue.id).padStart(3, '0')}
                  </span>

                  <span className="issue-description">
                    {issue.type} · Model confidence: {(issue.confidence * 100).toFixed(1)}%
                    {issue.duplicateIssueIds?.length > 0 && ` · ${issue.duplicateIssueIds.length + 1} matching detections`}
                  </span>

                  <span className="status-row">
                    <span className="review-badge">
                      {issue.reviewStatus}
                    </span>

                    <span className={workBadgeClass(issue.workOrderStatus)}>
                      {issue.workOrderStatus}
                    </span>
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
                onClick={() => { focusOnIssue(issue); setSelectedIssue(issue) }}
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

                  <span className={workBadgeClass(issue.workOrderStatus)}>
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
        </>
        )}
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
                <strong>ZIP code:</strong> {selectedIssue.zipCode || 'Not assigned'}
              </p>
              <p>
                <strong>Priority:</strong> {selectedIssue.priority}
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
              {selectedOrder && (
                <>
                  <p><strong>Assigned to:</strong> {selectedOrder.assignedTo}</p>
                  <p><strong>Created by:</strong> {selectedOrder.createdBy}</p>
                  {selectedOrder.notes && <p><strong>Notes:</strong> {selectedOrder.notes}</p>}
                </>
              )}
            </div>

            {person.role !== 'crew' && (
              <form key={`priority-${selectedIssue.id}`} className="priority-review-form" onSubmit={savePriority}>
                <h3>Review repair priority</h3>
                <label htmlFor="issue-priority">Priority
                  <select id="issue-priority" name="priority" defaultValue={selectedIssue.priority}>
                    {['Unassigned', 'Low', 'Medium', 'High', 'Critical'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label htmlFor="issue-priority-score">Priority score (0–100)
                  <input id="issue-priority-score" name="priorityScore" type="number" min="0" max="100" step="1"
                    defaultValue={selectedIssue.priorityScore ?? ''} placeholder="Unassigned" />
                </label>
                <p>Set by a reviewer; independent of model confidence. Leaving the score blank preserves its saved value.</p>
                <button type="submit" className="export-button">Save priority</button>
              </form>
            )}
            {person.role === 'reviewer' ? (
              <form key={selectedIssue.id} onSubmit={saveLocation} className="analysis-form report-metadata-form">
                <h3>Report metadata</h3>
                <label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" defaultValue={selectedIssue.latitude ?? ''} /></label>
                <label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" defaultValue={selectedIssue.longitude ?? ''} /></label>
                <label>Priority<select name="priority" defaultValue={selectedIssue.priority}>
                  {['Unassigned', 'Low', 'Medium', 'Critical'].map(value => <option key={value}>{value}</option>)}
                </select></label>
                <p>ZIP code: {selectedIssue.zipCode || 'Lookup pending or unavailable'} (from estimated coordinates)</p>
                <button disabled={savingMetadata}>{savingMetadata ? 'Saving…' : 'Save report metadata'}</button>
                {metadataFeedback && (!metadataFeedback.issueId || metadataFeedback.issueId === selectedIssue.id) && (
                  <p className={`report-feedback${metadataFeedback.error ? ' report-feedback-error' : ''}`} role={metadataFeedback.error ? 'alert' : 'status'}>{metadataFeedback.message}</p>
                )}
              </form>
            ) : (
              <p>
                <strong>Estimated location:</strong>{' '}
                {Number.isFinite(selectedIssue.latitude) && Number.isFinite(selectedIssue.longitude)
                  ? `${selectedIssue.latitude}, ${selectedIssue.longitude}`
                  : 'Unavailable'}
              </p>
            )}
            {apiError && <p role="alert">{apiError}</p>}
            {person.role === 'reviewer' ? (
              <>
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
              </>
            ) : (
              <p><strong>Review Status:</strong> {selectedIssue.reviewStatus}</p>
            )}
            {person.role === 'coordinator' && selectedIssue.workOrderId && (
              <button type="button" className="export-button work-order-link" onClick={() => {
                setOrderFocus(selectedIssue.workOrderId)
                setScreen('orders')
                dialogRef.current?.close()
              }}>View work order</button>
            )}
            {person.role === 'coordinator' && !selectedIssue.workOrderId && (
              selectedIssue.reviewStatus === 'Verified' ? (
                <form key={selectedIssue.id} className="work-order-form" onSubmit={createWorkOrder}>
                  <label>Assign to
                    <select name="assignedTo" defaultValue={CREW[0]?.name || ''} required>
                      {CREW.map(member => <option key={member.id} value={member.name}>{member.name}</option>)}
                    </select>
                  </label>
                  <label>Notes
                    <textarea name="notes" maxLength={500} rows={3} placeholder="What should the crew repair?" />
                  </label>
                  <button disabled={creatingOrder}>{creatingOrder ? 'Creating…' : 'Create work order'}</button>
                </form>
              ) : (
                <p className="role-note">A reviewer must mark this issue Verified before you can create a work order.</p>
              )
            )}

        </dialog>
      )}

    </div>
  )
}

export default App
