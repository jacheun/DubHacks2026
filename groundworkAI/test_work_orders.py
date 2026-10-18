"""Shared work orders: a coordinator creates one and someone else can view it."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import api


class WorkOrderTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(api, 'DB', Path(self.directory.name) / 'test.sqlite3')
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.addCleanup(self.directory.cleanup)

    def store(self, **changes):
        issue = {
            'id': 'issue-1', 'type': 'Pothole', 'location': 'Pine Street',
            'neighborhood': 'Capitol Hill', 'latitude': 47.61, 'longitude': -122.32,
            'description': 'AI-generated candidate requiring human review.',
            'reviewId': 'issue-1', 'reviewStatus': 'Verified', 'priority': 'High',
            'workOrderId': None, 'workOrderStatus': 'Not Created',
        }
        issue.update(changes)
        with api.connection() as db:
            db.execute('INSERT INTO issues VALUES (?, ?)', (issue['id'], json.dumps(issue)))
        return issue

    def create(self, **changes):
        body = {'issueId': 'issue-1', 'assignedTo': 'Alex Rivera', 'notes': 'Fill the pothole'}
        body.update(changes)
        return api.create_work_order(api.WorkOrderCreate(**body), role='coordinator', name='Jordan Hale')

    def test_coordinator_creates_and_crew_views_and_updates(self):
        self.store()
        created = self.create()
        self.assertEqual(created['id'], 'WO-001')
        self.assertEqual(created['status'], 'Open')
        self.assertEqual(created['createdBy'], 'Jordan Hale')
        self.assertEqual(created['type'], 'Pothole')
        self.assertEqual(created['location'], 'Pine Street')
        saved = api.issues()[0]
        self.assertEqual(saved['workOrderId'], 'WO-001')
        self.assertEqual(saved['workOrderStatus'], 'Open')

        visible = api.list_work_orders(role='crew', name='Alex Rivera')
        self.assertEqual(len(visible), 1)
        self.assertEqual(visible[0]['notes'], 'Fill the pothole')
        self.assertEqual(visible[0]['assignedTo'], 'Alex Rivera')

        updated = api.update_work_order(
            'WO-001', api.WorkOrderUpdate(status='In Progress'), role='crew', name='Alex Rivera')
        self.assertEqual(updated['status'], 'In Progress')
        self.assertEqual(updated['updatedBy'], 'Alex Rivera')
        self.assertEqual(api.issues()[0]['workOrderStatus'], 'In Progress')
        self.assertEqual(api.list_work_orders(role='coordinator', name='Jordan Hale')[0]['status'], 'In Progress')

    def test_reviewer_cannot_create_or_update_but_can_view(self):
        self.store()
        with self.assertRaises(api.HTTPException) as denied:
            api.create_work_order(
                api.WorkOrderCreate(issueId='issue-1', assignedTo='Alex Rivera'),
                role='reviewer', name='Maya Chen')
        self.assertEqual(denied.exception.status_code, 403)
        created = self.create()
        with self.assertRaises(api.HTTPException) as denied:
            api.update_work_order(
                created['id'], api.WorkOrderUpdate(status='Completed'), role='reviewer', name='Maya Chen')
        self.assertEqual(denied.exception.status_code, 403)
        self.assertEqual(api.list_work_orders(role='reviewer', name='Maya Chen')[0]['status'], 'Open')

    def test_only_verified_issues_can_be_ordered_once(self):
        self.store(reviewStatus='Pending')
        with self.assertRaises(api.HTTPException) as denied:
            self.create()
        self.assertEqual(denied.exception.status_code, 409)
        self.assertEqual(api.list_work_orders(role='coordinator', name='Jordan Hale'), [])

        with api.connection() as db:
            issue = json.loads(db.execute('SELECT data FROM issues WHERE id=?', ('issue-1',)).fetchone()[0])
            issue['reviewStatus'] = 'Verified'
            db.execute('UPDATE issues SET data=? WHERE id=?', (json.dumps(issue), 'issue-1'))
        self.create()
        with self.assertRaises(api.HTTPException) as denied:
            self.create(notes='Again')
        self.assertEqual(denied.exception.status_code, 409)
        self.assertEqual(len(api.list_work_orders(role='crew', name='Alex Rivera')), 1)

    def test_http_round_trip_uses_the_person_headers(self):
        from fastapi.testclient import TestClient
        self.store()
        with TestClient(api.app) as client:
            missing = client.post('/api/work-orders', json={'issueId': 'issue-1', 'assignedTo': 'Alex Rivera'})
            self.assertEqual(missing.status_code, 422)
            created = client.post(
                '/api/work-orders',
                json={'issueId': 'issue-1', 'assignedTo': 'Alex Rivera', 'notes': 'Patch it'},
                headers={'X-Groundwork-Role': 'coordinator', 'X-Groundwork-Name': 'Jordan Hale'},
            )
            self.assertEqual(created.status_code, 201, created.text)
            self.assertEqual(created.json()['createdBy'], 'Jordan Hale')
            listed = client.get(
                '/api/work-orders',
                headers={'X-Groundwork-Role': 'crew', 'X-Groundwork-Name': 'Alex Rivera'},
            )
            self.assertEqual(listed.status_code, 200)
            self.assertEqual(listed.json()[0]['notes'], 'Patch it')
            self.assertEqual(listed.json()[0]['location'], 'Pine Street')

    def test_missing_issue_and_unknown_person_are_rejected(self):
        with self.assertRaises(api.HTTPException) as missing:
            self.create()
        self.assertEqual(missing.exception.status_code, 404)
        with self.assertRaises(api.HTTPException) as unknown:
            api.list_work_orders(role='mayor', name='Pat')
        self.assertEqual(unknown.exception.status_code, 401)
        self.store()
        with self.assertRaises(api.HTTPException) as blank:
            self.create(assignedTo='   ')
        self.assertEqual(blank.exception.status_code, 422)
