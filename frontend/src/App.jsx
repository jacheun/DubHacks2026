import { useState } from 'react'
import heroImg from './assets/hero.png'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'

const initialIssues [
  {
    id: 1,
    type: 'Pothole',
    location: 'Rainier Ave S',
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

function App() {
  const [issues, setIssues] = useState(initialIssues)
  const [filter, setFilter] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [mapView, setMapView] = useState('Satellite')

  // Filter Infrastructure Issues
  const filterIssues = issues.filter((issue) => {
    const matchesReview =
      filter === 'all' ||
      issue.reviewStatus === filter

    const matchesSeverity =
      severity === 'all' ||
      issue.priority === severity

    const matchesSearch =
      issue.location.toLowerCase().includes(search.toLowerCase()) ||
      issue.type.toLowerCase().includes(search.toLowerCase())

    return matchesReview && matchesSeverity && matchesSearch
  })

  // Dash
  <>
      <div className="app">

        {/* Navigation */}
        <nav className="navbar">
          <h2>GroundWorkAI</h2>

          <div className="nav-links">
            <a href="#dashboard">Dashboard</a>
            <a href="#issues">Issues</a>
          </div>
        </nav>

        {/* Dashboard */}
        <main id="dashboard" className="dashboard">

          <div className="dashboard-header">
            <div>
              <h1>Infrastructure Dashboard</h1>
              <p>
                AI-powered Road and Sidewalk Inspection
              </p>
            </div>
          </div>

          {/* Statistics */}
          <div className="stats-grid">
            <div className="stat-card">
              <p>Total Issues</p>
              <h2>(issues.length)</h2>
            </div>

            <div className="stat-card">
              <p>Pending Review</p>
              <h2>
                {issues.filter(i => i.status === 'Pending').length}
              </h2>
            </div>

            <div className="stat-card">
              <p>High Priority</p>
              <h2>
                {issues.filter(i => i.priority === 'High').length}
              </h2>
            </div>
          </div>
          {/* Detected Issues */}
          <section id="issues" className="issues-section">

            <div className="seciton-header">
              <h2>Detected Issues</h2>

              <div className="filter-buttons">
                <button
                className={filter === ''}
              </div>
            </div>
          </section>
        </main>
        
export default App
