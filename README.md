# DubHacks2026

Report metadata: new reports start with Unassigned priority. Reviewers assign
Low, Medium, or Critical in the report details and save report metadata.
Priority scores are no longer used. ZIP codes are looked up from estimated
coordinates using Geocode Maps (https://geocode.maps.co/). Set
`GEOCODING_API_KEY=your_key` in `groundworkAI/.env` to enable this; the Mapillary
token is separate. Lookup results are cached in `runs/postal.sqlite3` and calls
are serialized with at least 1.1 seconds between requests. Failed lookups retry
after an hour and do not prevent damage reports being saved. Existing reports
are filled in the background when loaded; refresh to see the completed ZIPs.
Correcting coordinates refreshes the ZIP automatically. ZIP estimates may be
unavailable or inaccurate near boundaries. Search accepts ZIP, priority, partial
coordinates, or a `latitude, longitude` pair (within 2 km).
Group Members: Shivram Venkatachalam, Samantha Oh, Jackson Cheung, Savannah Lee

GroundworkAI is an AI-powered tool that detects road and sidewalk issues like potholes, cracks, and accessibility hazards using images. It helps pinpoint damaged areas and generates reports that local governments can use to prioritize repairs, making streets safer and more accessible for everyone.

## Local development

From the repository root, install dependencies and start the frontend:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Run `npm run build` to create a production build.


## Backend and model integration

Create/activate a virtual environment from the repository root:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r groundworkAI/requirements.txt
python -m uvicorn api:app --app-dir groundworkAI --reload --port 8000
```

Keep that terminal running. In a second terminal, run `npm run dev`.
Vite forwards `/api` requests to the backend at port 8000. Restart Vite after
changing its configuration. This proxy is for local development; deployed
hosting must also route `/api` to the Python service.

Put the trained weights at `groundworkAI/models/best.pt` and set
`MAPILLARY_TOKEN=your_token` in `groundworkAI/.env` (or the root `.env`).
Never commit tokens, datasets, weights, or generated results.

Pan/zoom the map to a neighborhood. Automatic scanning starts after a short pause;
you can toggle it off or use Scan map area to run another batch. The backend discovers
Mapillary image IDs from coverage vector tiles, processes a bounded batch in the
background, and adds road-damage candidates to the dashboard as it progresses.
No manual image IDs are needed. Repeating a scan moves on to unprocessed images.
Candidates appear in the issue list and on the map when coordinates are available.
Open a marker's popup and choose View issue details to inspect the evidence box,
review status, confidence, source link, and estimated location. Review changes
and coordinate edits persist in SQLite at `runs/issues.sqlite3`.
CSV export uses the currently filtered issues. The dashboard starts empty;
it no longer treats sample issues as real detections.

- `POST /api/scans`: JSON `{ "bbox": [-122.329, 47.606, -122.328, 47.607], "limit": 10 }`
- `GET /api/scans/{id}`: discovery/inference progress and failures
- `GET /api/issues`: saved candidates
- `POST /api/analyze`: JSON `{ "imageId": "131416445693864", "confidence": 0.35 }`
- `PATCH /api/issues/{id}`: review status or both latitude and longitude
- `GET /api/images/{image-id}/original.jpg`: evidence image
- `http://127.0.0.1:8000/docs`: interactive API documentation

Repeated requests for the same image, weights, and threshold reuse the saved
analysis and preserve review decisions. Replacing the weights starts a new
model version; previous candidates stay available. Zero detections do not prove
a road is safe. Confidence is separate from repair priority. Camera locations
are approximate, and reviewer adjustments remain estimates. Area discovery uses vector tiles rather than the Graph area endpoint that returned
HTTP 500. Scans are limited to 16 coverage tiles and 30 images per batch. Potholes, longitudinal cracks, transverse cracks, and alligator cracks
become pending dashboard issues. Analysis cache keys include the processing version
so earlier pothole-only results do not suppress crack reprocessing. The local worker is intended for a single backend process;
interrupted scans are marked failed at restart and can be started again.


Map scans capture the latest visible bounds after movement ends. Moving to a new
area supersedes the previous scan between images; an in-flight download or model
prediction may finish first. The dashboard/map/export show saved issues within
the current viewport, while older issues stay in the database and reappear when
you return. Zoom out too far and scanning asks you to zoom to a neighborhood.

Overlapping detections of the same class within the same Mapillary image are
consolidated in API issue lists. Distinct boxes, different classes, and different
source images remain separate. Reviewed records take precedence; conflicting
review decisions remain separate for inspection. Existing database rows are
retained, and repeated analyses attach observations to the existing issue while
preserving its status, adjusted coordinates, and work order. This does not merge
defects across different photos based on approximate camera coordinates.


## Hosted deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Vercel frontend/API bridge and Render
Docker backend with bundled weights and persistent storage. The selected
`groundworkAI/models/best.pt` is intentionally versioned for deployment; other
model files, training data, local secrets, and generated runs remain ignored.

## Saved-image demo (default)

Run `npm run dev` to use five bundled Mapillary images with saved YOLO crack
predictions. No Python server, Mapillary token, live inference, or Cloudflare
Tunnel is needed. The map fits the saved examples and live scan controls are
replaced with a saved-demo banner. All five findings start Pending, with repair
priority unassigned; confidence is not a severity score.

Reviewer decisions, adjusted locations, priorities, and coordinator/crew work
orders persist in this browser's localStorage. They are not shared between users
or devices. The same default demo works as a static Vercel frontend. Basemap tiles
and opening external Mapillary source links still require internet access.

The five original photos live in `frontend/public/demo/images/`; detection data
and provenance are in `frontend/src/demo-data.json`. These are actual stored model
predictions, not verified field reports. They show cracks, not pothole detections.
The demo retains the strongest prediction per photo.

To deliberately restore the live backend workflow, set `VITE_USE_LIVE_API=true`
before starting Vite or building for deployment. Hosted live mode additionally
requires the API backend/proxy configuration in DEPLOYMENT.md. Leave this variable
unset for the standalone saved demo.

Run `node --test scripts/test-demo-api.mjs` to check the saved-demo workflows.
