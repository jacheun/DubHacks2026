"""Local dashboard API. Run: uvicorn api:app --app-dir groundworkAI"""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import sqlite3
from pathlib import Path
from threading import Event, Lock
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from postal import lookup_zip
from discovery import discover_images
from deduplication import deduplicate, same_defect

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import os

from main import ROOT, FIELDS, fetch_json, process_image

from settings import DATA_DIR, MODEL_PATH

DATA = DATA_DIR
DATA.mkdir(parents=True, exist_ok=True)
IMAGES = DATA / 'mapillary'
IMAGES.mkdir(exist_ok=True)
DB = DATA / 'issues.sqlite3'
DAMAGE_TYPES = {
    'pothole': 'Pothole', 'potholes': 'Pothole', 'd40': 'Pothole',
    'longitudinal crack': 'Longitudinal Crack', 'd00': 'Longitudinal Crack',
    'transverse crack': 'Transverse Crack', 'd10': 'Transverse Crack',
    'alligator crack': 'Alligator Crack', 'd20': 'Alligator Crack',
}
ANALYSIS_SCHEMA = 'road-damage-v2'
LOCK = Lock()
SCAN_LOCK = Lock()
CANCELLATIONS = {}
WORKER = ThreadPoolExecutor(max_workers=1)
POSTAL_WORKER = ThreadPoolExecutor(max_workers=1)
POSTAL_LOCK = Lock()
app = FastAPI(title='GroundworkAI')
app.mount('/api/images', StaticFiles(directory=IMAGES), name='images')

@app.get('/api/health')
def health():
    if not MODEL_PATH.is_file():
        raise HTTPException(503, 'Model weights are missing.')
    with connection() as db:
        db.execute('SELECT 1')
    return {'status': 'ok', 'modelVersion': hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()[:12]}



@contextmanager
def connection():
    db = sqlite3.connect(DB, timeout=30)
    try:
        db.execute('CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS work_orders (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        with db:
            yield db
    finally:
        db.close()


class AnalysisRequest(BaseModel):
    imageId: str = Field(pattern=r'^\d{1,30}$')
    confidence: float = Field(default=0.35, gt=0, le=1)


def report_metadata(issue):
    issue = dict(issue)
    if issue.get('priority') not in {'Low', 'Medium', 'Critical'}:
        issue['priority'] = 'Critical' if issue.get('priority') == 'High' else 'Unassigned'
    issue.setdefault('zipCode', '')
    issue.pop('priorityScore', None)
    return issue


class ReviewRequest(BaseModel):
    priority: str | None = Field(default=None, pattern=r'^(Unassigned|Low|Medium|Critical)$')
    zipCode: str | None = Field(default=None, pattern=r'^(?:[0-9]{5}(?:-[0-9]{4})?)?$')
    reviewStatus: str | None = Field(default=None, pattern=r'^(Pending|Under Review|Verified|Rejected)$')
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class WorkOrderCreate(BaseModel):
    issueId: str = Field(min_length=1, max_length=240)
    notes: str = Field(default='', max_length=500)
    assignedTo: str = Field(min_length=1, max_length=80)


class WorkOrderUpdate(BaseModel):
    status: str = Field(pattern=r'^(Open|In Progress|Completed)$')


ROLES = {'reviewer', 'coordinator', 'crew'}
ISSUE_FIELDS = (
    'type', 'location', 'neighborhood', 'zipCode', 'latitude', 'longitude', 'priority',
    'description', 'confidence', 'imageUrl', 'imageWidth', 'imageHeight', 'bbox',
    'reviewStatus', 'sourceImageId', 'locationAccuracy',
)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def read_actor(role, name):
    cleaned_role = str(role or '').strip().lower()
    cleaned_name = ' '.join(str(name or '').split())
    if cleaned_role not in ROLES or not cleaned_name or len(cleaned_name) > 80:
        raise HTTPException(401, 'Choose who is using Groundwork before continuing.')
    return {'role': cleaned_role, 'name': cleaned_name}


def present_order(order, issue):
    view = dict(order)
    if issue:
        view.update({key: issue.get(key) for key in ISSUE_FIELDS})
    return view


def next_work_order_id(db):
    current = 0
    for (row_id,) in db.execute('SELECT id FROM work_orders'):
        if isinstance(row_id, str) and row_id.startswith('WO-') and row_id[3:].isdigit():
            current = max(current, int(row_id[3:]))
    return f'WO-{current + 1:03d}'


@app.get('/api/issues')
def issues():
    with connection() as db:
        reports = [report_metadata(issue) for issue in deduplicate([json.loads(row[0]) for row in db.execute('SELECT data FROM issues ORDER BY id')])]
    load_dotenv(ROOT / '.env')
    load_dotenv(Path(__file__).parent / '.env')
    if os.getenv('GEOCODING_API_KEY') and any(not issue.get('zipCode') for issue in reports) and POSTAL_LOCK.acquire(blocking=False):
        POSTAL_WORKER.submit(fill_missing_zip_codes, reports)
    return reports


def fill_missing_zip_codes(reports):
    try:
        for issue in reports:
            if issue.get('zipCode'):
                continue
            code = lookup_zip(issue.get('latitude'), issue.get('longitude'))
            if not code:
                continue
            with connection() as db:
                row = db.execute('SELECT data FROM issues WHERE id=?', (issue['id'],)).fetchone()
                if not row:
                    continue
                current = json.loads(row[0])
                if not current.get('zipCode') and all(current.get(key) == issue.get(key) for key in ['latitude', 'longitude']):
                    current['zipCode'] = code
                    db.execute('UPDATE issues SET data=? WHERE id=?', (json.dumps(current), issue['id']))
    finally:
        POSTAL_LOCK.release()


@app.patch('/api/issues/{issue_id}')
def update_issue(issue_id: str, update: ReviewRequest):
    if (update.latitude is None) != (update.longitude is None):
        raise HTTPException(422, 'Provide both latitude and longitude.')
    with connection() as db:
        row = db.execute('SELECT data FROM issues WHERE id=?', (issue_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Issue not found')
        issue = report_metadata(json.loads(row[0]))
        moved = update.latitude is not None and (issue.get('latitude'), issue.get('longitude')) != (update.latitude, update.longitude)
        issue.update(update.model_dump(exclude_none=True))
        if moved:
            issue['locationAccuracy'] = 'reviewer_adjusted'
            issue['zipCode'] = ''
        db.execute('UPDATE issues SET data=? WHERE id=?', (json.dumps(issue), issue_id))
    if moved and POSTAL_LOCK.acquire(blocking=False):
        POSTAL_WORKER.submit(fill_missing_zip_codes, [issue])
    return issue


@app.get('/api/work-orders')
def list_work_orders(
    role: str = Header(alias='X-Groundwork-Role'),
    name: str = Header(alias='X-Groundwork-Name'),
):
    read_actor(role, name)
    with connection() as db:
        orders = [json.loads(row[0]) for row in db.execute('SELECT data FROM work_orders ORDER BY id')]
        issues = {row[0]: json.loads(row[1]) for row in db.execute('SELECT id, data FROM issues')}
    return [present_order(order, issues.get(order['issueId'])) for order in orders]


@app.post('/api/work-orders', status_code=201)
def create_work_order(
    body: WorkOrderCreate,
    role: str = Header(alias='X-Groundwork-Role'),
    name: str = Header(alias='X-Groundwork-Name'),
):
    actor = read_actor(role, name)
    if actor['role'] != 'coordinator':
        raise HTTPException(403, 'Only a coordinator can create a work order.')
    assigned_to = ' '.join(body.assignedTo.split())
    if not assigned_to:
        raise HTTPException(422, 'Choose who should receive this work order.')
    with LOCK:
        with connection() as db:
            row = db.execute('SELECT data FROM issues WHERE id=?', (body.issueId,)).fetchone()
            if not row:
                raise HTTPException(404, 'Issue not found.')
            issue = json.loads(row[0])
            if issue.get('reviewStatus') != 'Verified':
                raise HTTPException(409, 'A reviewer must verify this issue before a work order can be created.')
            if issue.get('workOrderId'):
                raise HTTPException(409, 'This issue already has a work order.')
            order = {
                'id': next_work_order_id(db), 'issueId': issue['id'], 'status': 'Open',
                'notes': body.notes.strip(), 'assignedTo': assigned_to,
                'createdBy': actor['name'], 'createdAt': utc_now(),
            }
            issue['workOrderId'] = order['id']
            issue['workOrderStatus'] = order['status']
            db.execute('INSERT INTO work_orders VALUES (?, ?)', (order['id'], json.dumps(order)))
            db.execute('UPDATE issues SET data=? WHERE id=?', (json.dumps(issue), issue['id']))
    return present_order(order, issue)


@app.patch('/api/work-orders/{order_id}')
def update_work_order(
    order_id: str,
    update: WorkOrderUpdate,
    role: str = Header(alias='X-Groundwork-Role'),
    name: str = Header(alias='X-Groundwork-Name'),
):
    actor = read_actor(role, name)
    if actor['role'] not in {'crew', 'coordinator'}:
        raise HTTPException(403, 'Only crew or a coordinator can update a work order.')
    if not (order_id.startswith('WO-') and order_id[3:].isdigit()):
        raise HTTPException(404, 'Work order not found.')
    with LOCK:
        with connection() as db:
            row = db.execute('SELECT data FROM work_orders WHERE id=?', (order_id,)).fetchone()
            if not row:
                raise HTTPException(404, 'Work order not found.')
            order = json.loads(row[0])
            order['status'] = update.status
            order['updatedBy'] = actor['name']
            order['updatedAt'] = utc_now()
            db.execute('UPDATE work_orders SET data=? WHERE id=?', (json.dumps(order), order_id))
            issue_row = db.execute('SELECT data FROM issues WHERE id=?', (order['issueId'],)).fetchone()
            issue = json.loads(issue_row[0]) if issue_row else None
            if issue is not None:
                issue['workOrderStatus'] = order['status']
                db.execute('UPDATE issues SET data=? WHERE id=?', (json.dumps(issue), issue['id']))
    return present_order(order, issue)


@app.post('/api/analyze')
def analyze(body: AnalysisRequest):
    # Serialize inference and writes; repeated requests preserve review decisions.
    with LOCK:
        weights = MODEL_PATH
        if not weights.exists():
            raise HTTPException(503, 'Install models/best.pt before analyzing images.')
        version = hashlib.sha256(weights.read_bytes()).hexdigest()[:12]
        key = f'{body.imageId}-{version}-{body.confidence}-{ANALYSIS_SCHEMA}'
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
                issue_type = DAMAGE_TYPES.get(detection['label'].lower().replace('_', ' '))
                if issue_type is None:
                    continue
                issue_id = f'{key}-{index}'
                issue = {
                    'id': issue_id, 'type': issue_type,
                    'location': f'Mapillary image {body.imageId}', 'neighborhood': 'Unknown',
                    'latitude': location.get('latitude'), 'longitude': location.get('longitude'),
                    'locationAccuracy': report['location_accuracy'],
                    'description': 'AI-generated candidate requiring human review.',
                    'confidence': detection['confidence'], 'bbox': detection['bbox_xyxy'],
                    'imageWidth': report['image_width'], 'imageHeight': report['image_height'],
                    'imageUrl': f'/api/images/{body.imageId}/original.jpg',
                    'sourceImageId': body.imageId, 'capturedAt': report['captured_at'],
                    'modelVersion': version, 'priority': 'Unassigned', 'zipCode': lookup_zip(location.get('latitude'), location.get('longitude')),
                    'reviewId': issue_id, 'reviewStatus': 'Pending',
                    'workOrderId': None, 'workOrderStatus': 'Not Created',
                }
                existing = deduplicate([json.loads(row[0]) for row in db.execute('SELECT data FROM issues')])
                match = next((candidate for candidate in existing if same_defect(candidate, issue)), None)
                if match is not None:
                    # Retain the original evidence and review fields; record new observations separately.
                    canonical = json.loads(db.execute('SELECT data FROM issues WHERE id=?', (match['id'],)).fetchone()[0])
                    observation = {key: issue[key] for key in ['modelVersion', 'confidence', 'bbox', 'imageWidth', 'imageHeight']}
                    observations = canonical.setdefault('observations', [])
                    if observation not in observations:
                        observations.append(observation)
                    db.execute('UPDATE issues SET data=? WHERE id=?', (json.dumps(canonical), canonical['id']))
                    created.append(canonical['id'])
                else:
                    db.execute('INSERT OR IGNORE INTO issues VALUES (?, ?)', (issue_id, json.dumps(issue)))
                    created.append(issue_id)
            created = list(dict.fromkeys(created))
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
        weights = MODEL_PATH
        if not weights.exists():
            raise ValueError('Install models/best.pt before scanning.')
        version = hashlib.sha256(weights.read_bytes()).hexdigest()[:12]
        with connection() as db:
            processed = {row[0] for row in db.execute('SELECT id FROM analyses')}
        pending = [image_id for image_id in image_ids
                   if f'{image_id}-{version}-{body.confidence}-{ANALYSIS_SCHEMA}' not in processed]
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
    except requests.RequestException:
        scan['status'] = 'failed'
        scan['error'] = 'Mapillary network request failed. Check backend connectivity and retry.'
    except ValueError as error:
        scan['status'] = 'failed'
        message = str(error)
        scan['error'] = message if 'access_token' not in message.lower() and 'https://' not in message.lower() else 'Imagery processing failed.'
    except OSError:
        scan['status'] = 'failed'
        scan['error'] = 'Could not read or write imagery. Check backend storage and retry.'
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
