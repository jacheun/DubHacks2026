import { useEffect } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const priorityColors = { Critical: '#c44735', High: '#d68b32', Medium: '#728a5c' }

function MapControls({ issues, focusedIssue }) {
  const map = useMap()

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false })
    })
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])

  const issueCoordinates = JSON.stringify(issues.map(issue => [issue.latitude, issue.longitude]))

  useEffect(() => {
    const coordinates = JSON.parse(issueCoordinates)
    if (coordinates.length) {
      map.fitBounds(coordinates, {
        padding: [45, 45], maxZoom: 15,
      })
    }
  }, [issueCoordinates, map])

  useEffect(() => {
    if (focusedIssue) {
      map.flyTo([focusedIssue.latitude, focusedIssue.longitude], 17, { duration: 1 })
    }
  }, [focusedIssue, map])

  return (
    <div className="issue-map-actions" onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}>
      <span role="status">{issues.length ? 'Drag to explore · Scroll to zoom · Select a marker' : 'No issues match your filters.'}</span>
    </div>
  )
}

export default function IssueMap({ issues, focusedIssue, onFocusIssue, onSelectIssue, view = 'Road' }) {
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
      <MapControls issues={issues} focusedIssue={focusedIssue} />
      {issues.map(issue => (
        <CircleMarker
          key={issue.id}
          center={[issue.latitude, issue.longitude]}
          radius={10}
          eventHandlers={{ click: () => onFocusIssue(issue) }}
          pathOptions={{
            color: '#fff', weight: 2,
            fillColor: priorityColors[issue.priority] ?? '#728a5c',
            fillOpacity: 0.9,
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
