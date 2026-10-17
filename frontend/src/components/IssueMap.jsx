import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const priorityColors = { Critical: '#c44735', High: '#d68b32', Medium: '#728a5c' }

function MapControls({ issues }) {
  const map = useMap()
  const [locationStatus, setLocationStatus] = useState('')
  const [userLocation, setUserLocation] = useState(null)

  function fitIssues() {
    if (issues.length) {
      map.fitBounds(issues.map(issue => [issue.latitude, issue.longitude]), {
        padding: [45, 45], maxZoom: 15,
      })
    }
  }

  useEffect(() => {
    if (issues.length) {
      map.fitBounds(issues.map(issue => [issue.latitude, issue.longitude]), {
        padding: [45, 45], maxZoom: 15,
      })
    }
  }, [issues, map])

  function locateUser() {
    if (!navigator.geolocation) {
      setLocationStatus('Your browser does not support location access.')
      return
    }
    setLocationStatus('Finding your location…')
    navigator.geolocation.getCurrentPosition(position => {
      const coordinates = [position.coords.latitude, position.coords.longitude]
      setUserLocation(coordinates)
      map.flyTo(coordinates, 14)
      setLocationStatus('Showing your location.')
    }, () => setLocationStatus('Location unavailable. Check your browser location permissions.'), {
      enableHighAccuracy: true, timeout: 10000,
    })
  }

  return (
    <>
      <div className="issue-map-actions" onPointerDown={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}>
        <button type="button" onClick={fitIssues} disabled={!issues.length}>Show all issues</button>
        <button type="button" onClick={locateUser}>My location</button>
        <span role="status">{locationStatus || (issues.length ? 'Drag to explore · Scroll to zoom · Select a marker' : 'No issues match your filters.')}</span>
      </div>
      {userLocation && (
        <CircleMarker center={userLocation} radius={8}
          pathOptions={{ color: '#fff', weight: 3, fillColor: '#2877df', fillOpacity: 1 }}>
          <Tooltip>Your location</Tooltip>
        </CircleMarker>
      )}
    </>
  )
}

export default function IssueMap({ issues, onSelectIssue, view = 'Road' }) {
  const satellite = view === 'Satellite'

  return (
    <MapContainer
      className="issue-map"
      center={[47.635, -122.335]}
      zoom={11}
      scrollWheelZoom
    >
      <TileLayer
        key={satellite ? 'satellite' : 'road'}
        url={satellite
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
        attribution={satellite
          ? 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
          : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
      />
      <MapControls issues={issues} />
      {issues.map(issue => (
        <CircleMarker
          key={issue.id}
          center={[issue.latitude, issue.longitude]}
          radius={view === 'Risk' ? 8 + issue.priorityScore / 6 : 10}
          pathOptions={{
            color: '#fff', weight: 2,
            fillColor: priorityColors[issue.priority] ?? '#728a5c',
            fillOpacity: view === 'Risk' ? 0.55 : 0.9,
          }}
        >
          <Tooltip>{issue.location} · {issue.type} · {issue.priority}</Tooltip>
          <Popup>
            <div className="issue-map-popup">
              <strong>{issue.type}</strong>
              <p>{issue.location} · {issue.neighborhood}</p>
              <p>{issue.description}</p>
              <p>{issue.priority} priority · Score {issue.priorityScore}</p>
              <button type="button" onClick={() => onSelectIssue(issue)}>View issue details</button>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
