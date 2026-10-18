"""Local dashboard API. Run: uvicorn api:app --app-dir groundworkAI"""
from contextlib import contextmanager
import hashlib
import json
import sqlite3
from pathlib import Path
from threading import Event, Lock
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from discovery import discover_images

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import os

from main import ROOT, FIELDS, fetch_json, process_image

DATA = ROOT / 'runs'
DATA.mkdir(exist_ok=True)
IMAGES = DATA / 'mapillary'
IMAGES.mkdir(exist_ok=True)
DB = DATA / 'issues.sqlite3'
LOCK = Lock()
SCAN_LOCK = Lock()
CANCELLATIONS = {}
WORKER = ThreadPoolExecutor(max_workers=1)
app = FastAPI(title='GroundworkAI')
app.mount('/api/images', StaticFiles(directory=IMAGES), name='images')


@contextmanager
def connection():
    db = sqlite3.connect(DB, timeout=30)
    try:
        db.execute('CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        with db:
            yield db
    finally:
        db.close()


class AnalysisRequest(BaseModel):
    imageId: str = Field(pattern=r'^\d{1,30}$')
    confidence: float = Field(default=0.35, gt=0, le=1)


class ReviewRequest(BaseModel):
    reviewStatus: str | None = Field(default=None, pattern=r'^(Pending|Under Review|Verified|Rejected)$')
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


@app.get('/api/issues')
def issues():
    with connection() as db:
        return [json.loads(row[0]) for row in db.execute('SELECT data FROM issues ORDER BY id')]


@app.patch('/api/issues/{issue_id}')
def update_issue(issue_id: str, update: ReviewRequest):
    if (update.latitude is None) != (update.longitude is None):
        raise HTTPException(422, 'Provide both latitude and longitude.')
    with connection() as db:
        row = db.execute('SELECT data FROM issues WHERE id=?', (issue_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Issue not found')
        issue = json.loads(row[0])
        issue.update(update.model_dump(exclude_none=True))
        if update.latitude is not None:
            issue['locationAccuracy'] = 'reviewer_adjusted'
        db.execute('UPDATE issues SET data=? WHERE id=?', (json.dumps(issue), issue_id))
    return issue


@app.post('/api/analyze')
def analyze(body: AnalysisRequest):
    # Serialize inference and writes; repeated requests preserve review decisions.
    with LOCK:
        weights = Path(__file__).parent / 'models/best.pt'
        if not weights.exists():
            raise HTTPException(503, 'Install models/best.pt before analyzing images.')
        version = hashlib.sha256(weights.read_bytes()).hexdigest()[:12]
        key = f'{body.imageId}-{version}-{body.confidence}'
        with connection() as db:
            cached = db.execute('SELECT data FROM analyses WHERE id=?', (key,)).fetchone()
        if cached:
            return json.loads(cached[0])
        load_dotenv(ROOT / '.env')
        load_dotenv(Path(__file__).parent / '.env')
        token = os.getenv('MAPILLARY_TOKEN')
        if not token:
            raise HTTPException(503, 'Configure MAPILLARY_TOKEN in the backend .env file.')
        try:
            with requests.Session() as session:
                metadata = fetch_json(session, body.imageId, token, {'fields': FIELDS})
                report = process_image(session, metadata, body.confidence)
        except requests.RequestException:
            raise HTTPException(502, 'Mapillary request failed. Retry later.') from None
        except (ValueError, OSError):
            raise HTTPException(502, 'Could not retrieve or analyze this Mapillary image.') from None
        location = report['camera_location'] or {}
        created = []
        with connection() as db:
            for index, detection in enumerate(report['detections']):
                if detection['label'].lower().replace('_', ' ') not in {'pothole', 'potholes', 'd40'}:
                    continue
                issue_id = f'{key}-{index}'
                issue = {
                    'id': issue_id, 'type': detection['label'].replace('_', ' ').title(),
                    'location': f'Mapillary image {body.imageId}', 'neighborhood': 'Unknown',
                    'latitude': location.get('latitude'), 'longitude': location.get('longitude'),
                    'locationAccuracy': report['location_accuracy'],
                    'description': 'AI-generated candidate requiring human review.',
                    'confidence': detection['confidence'], 'bbox': detection['bbox_xyxy'],
                    'imageWidth': report['image_width'], 'imageHeight': report['image_height'],
                    'imageUrl': f'/api/images/{body.imageId}/original.jpg',
                    'sourceImageId': body.imageId, 'capturedAt': report['captured_at'],
                    'modelVersion': version, 'priority': 'Unassigned', 'priorityScore': None,
                    'reviewId': issue_id, 'reviewStatus': 'Pending',
                    'workOrderId': None, 'workOrderStatus': 'Not Created',
                }
                db.execute('INSERT OR IGNORE INTO issues VALUES (?, ?)', (issue_id, json.dumps(issue)))
                created.append(issue_id)
            response = {'imageId': body.imageId, 'issueIds': created,
                        'detectionCount': len(created),
                        'imageUrl': f'/api/images/{body.imageId}/original.jpg'}
            db.execute('INSERT INTO analyses VALUES (?, ?)', (key, json.dumps(response)))
        return response


class ScanRequest(BaseModel):
    bbox: tuple[float, float, float, float] = (-122.335, 47.602, -122.325, 47.612)
    limit: int = Field(default=10, ge=1, le=30)
    confidence: float = Field(default=0.35, gt=0, le=1)


def save_scan(scan):
    with connection() as db:
        db.execute('INSERT OR REPLACE INTO scans VALUES (?, ?)', (scan['id'], json.dumps(scan)))


def run_scan(scan, body):
    cancelled = CANCELLATIONS.get(scan['id'], Event())
    try:
        if cancelled.is_set():
            scan['status'] = 'cancelled'
            return
        load_dotenv(ROOT / '.env')
        load_dotenv(Path(__file__).parent / '.env')
        token = os.getenv('MAPILLARY_TOKEN')
        if not token:
            raise ValueError('Configure MAPILLARY_TOKEN in the backend .env file.')
        image_ids = discover_images(body.bbox, token)
        if cancelled.is_set():
            scan['status'] = 'cancelled'
            return
        scan['discovered'] = len(image_ids)
        weights = Path(__file__).parent / 'models/best.pt'
        if not weights.exists():
            raise ValueError('Install models/best.pt before scanning.')
        version = hashlib.sha256(weights.read_bytes()).hexdigest()[:12]
        with connection() as db:
            processed = {row[0] for row in db.execute('SELECT id FROM analyses')}
        pending = [image_id for image_id in image_ids
                   if f'{image_id}-{version}-{body.confidence}' not in processed]
        scan['skipped'] = len(image_ids) - len(pending)
        selected = pending[:body.limit]
        scan['total'] = len(selected)
        scan['status'] = 'processing'
        save_scan(scan)
        for image_id in selected:
            if cancelled.is_set():
                break
            try:
                result = analyze(AnalysisRequest(imageId=image_id, confidence=body.confidence))
                scan['detections'] += result['detectionCount']
            except HTTPException:
                scan['failed'] += 1
            scan['processed'] += 1
            save_scan(scan)
        scan['status'] = 'cancelled' if cancelled.is_set() else 'completed'
    except (ValueError, OSError) as error:
        scan['status'] = 'failed'
        scan['error'] = str(error)
    except Exception:
        # Requests can include credentials in their exception URLs.
        scan['status'] = 'failed'
        scan['error'] = 'Imagery discovery failed. Check backend connectivity and retry.'
    finally:
        save_scan(scan)
        CANCELLATIONS.pop(scan['id'], None)


@app.post('/api/scans', status_code=202)
def start_scan(body: ScanRequest):
    from discovery import tile_xy
    west, south, east, north = body.bbox
    if not (-180 <= west < east <= 180 and -85 <= south < north <= 85):
        raise HTTPException(422, 'Invalid map bounds.')
    left, top = tile_xy(west, north)
    right, bottom = tile_xy(east, south)
    if (right-left+1) * (bottom-top+1) > 16:
        raise HTTPException(422, 'Zoom in to a neighborhood before scanning.')
    with SCAN_LOCK:
        with connection() as db:
            for row in db.execute('SELECT data FROM scans'):
                existing = json.loads(row[0])
                if existing['status'] in {'discovering', 'processing'}:
                    if (existing.get('bbox') == list(body.bbox)
                            and existing.get('confidence', 0.35) == body.confidence
                            and existing.get('limit', 10) == body.limit
                            and not CANCELLATIONS.get(existing['id'], Event()).is_set()):
                        return existing
                    event = CANCELLATIONS.get(existing['id'])
                    if event:
                        event.set()
        scan = {'id': uuid4().hex, 'status': 'discovering', 'discovered': 0,
                'total': 0, 'processed': 0, 'failed': 0, 'skipped': 0, 'detections': 0,
                'bbox': body.bbox, 'limit': body.limit, 'confidence': body.confidence, 'error': None}
        save_scan(scan)
        CANCELLATIONS[scan['id']] = Event()
        WORKER.submit(run_scan, scan.copy(), body)
        return scan


@app.get('/api/scans/{scan_id}')
def get_scan(scan_id: str):
    with connection() as db:
        row = db.execute('SELECT data FROM scans WHERE id=?', (scan_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Scan not found.')
    return json.loads(row[0])


@app.on_event('startup')
def recover_interrupted_scans():
    with connection() as db:
        for row in db.execute('SELECT data FROM scans').fetchall():
            scan = json.loads(row[0])
            if scan['status'] in {'discovering', 'processing'}:
                scan.update(status='failed', error='Backend restarted. Start a new scan to continue.')
                db.execute('UPDATE scans SET data=? WHERE id=?', (json.dumps(scan), scan['id']))


@app.get('/api/scans')
def latest_scan():
    with connection() as db:
        row = db.execute('SELECT data FROM scans ORDER BY rowid DESC LIMIT 1').fetchone()
    return json.loads(row[0]) if row else None
