"""Offline integration checks: python -m unittest discover -s groundworkAI -p 'test_*.py'."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import api


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(api, 'DB', Path(self.directory.name) / 'test.sqlite3')
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.addCleanup(self.directory.cleanup)
        self.token_patch = patch.dict('os.environ', {'MAPILLARY_TOKEN': 'test'})
        self.token_patch.start()
        self.addCleanup(self.token_patch.stop)

    def report(self):
        return {
            'camera_location': {'latitude': 47.6065, 'longitude': -122.3285},
            'location_accuracy': 'approximate', 'captured_at': 123,
            'image_width': 640, 'image_height': 480,
            'detections': [
                {'label': 'pothole', 'confidence': .8, 'bbox_xyxy': [1, 2, 30, 40]},
                {'label': 'longitudinal_crack', 'confidence': .9, 'bbox_xyxy': [1, 2, 10, 20]},
            ],
        }

    def scan(self):
        return {'id': 'test', 'status': 'discovering', 'discovered': 0,
                'total': 0, 'processed': 0, 'failed': 0, 'skipped': 0,
                'detections': 0, 'error': None}

    def test_discovery_to_issues_and_repeat_preserves_review(self):
        with patch.object(api, 'discover_images', return_value=['123', '456']), \
             patch.object(api, 'fetch_json', return_value={'id': '123'}), \
             patch.object(api, 'process_image', return_value=self.report()) as inference:
            scan = self.scan()
            api.run_scan(scan, api.ScanRequest(limit=2))
            self.assertEqual(scan['status'], 'completed')
            self.assertEqual(scan['detections'], 4)  # Both cracks and potholes become issues.
            issues = api.issues()
            self.assertEqual(len(issues), 4)
            self.assertEqual({issue['type'] for issue in issues}, {'Pothole', 'Longitudinal Crack'})
            api.update_issue(issues[0]['id'], api.ReviewRequest(reviewStatus='Rejected'))
            repeat = self.scan()
            api.run_scan(repeat, api.ScanRequest(limit=2))
            self.assertEqual(repeat['skipped'], 2)
            self.assertEqual(repeat['processed'], 0)
            self.assertEqual(inference.call_count, 2)
            self.assertEqual(api.issues()[0]['reviewStatus'], 'Rejected')

    def test_reanalysis_reuses_issues_and_preserves_review(self):
        with patch.object(api, 'fetch_json', return_value={'id': '123'}), \
             patch.object(api, 'process_image', return_value=self.report()):
            first = api.analyze(api.AnalysisRequest(imageId='123', confidence=.35))
            issue_id = first['issueIds'][0]
            api.update_issue(issue_id, api.ReviewRequest(reviewStatus='Verified', latitude=48, longitude=-123))
            second = api.analyze(api.AnalysisRequest(imageId='123', confidence=.5))
            self.assertEqual(set(first['issueIds']), set(second['issueIds']))
            self.assertEqual(len(api.issues()), 2)
            saved = next(issue for issue in api.issues() if issue['id'] == issue_id)
            self.assertEqual(saved['reviewStatus'], 'Verified')
            self.assertEqual(saved['latitude'], 48)
            self.assertEqual(len(saved['observations']), 1)

    def test_no_coverage_completes_without_issues(self):
        with patch.object(api, 'discover_images', return_value=[]):
            scan = self.scan()
            api.run_scan(scan, api.ScanRequest())
            self.assertEqual(scan['status'], 'completed')
            self.assertEqual(api.issues(), [])

    def test_partial_failure_keeps_successful_candidates(self):
        with patch.object(api, 'discover_images', return_value=['123', '456']), \
             patch.object(api, 'fetch_json', return_value={'id': '123'}), \
             patch.object(api, 'process_image', side_effect=[ValueError('bad image'), self.report()]):
            scan = self.scan()
            api.run_scan(scan, api.ScanRequest(limit=2))
            self.assertEqual(scan['status'], 'completed')
            self.assertEqual(scan['failed'], 1)
            self.assertEqual(len(api.issues()), 2)

    def test_restart_marks_unfinished_scan_failed(self):
        api.save_scan(self.scan())
        api.recover_interrupted_scans()
        self.assertEqual(api.get_scan('test')['status'], 'failed')

    def test_new_viewport_cancels_old_scan_and_uses_new_bounds(self):
        with patch.object(api.WORKER, 'submit'):
            first = api.start_scan(api.ScanRequest(bbox=(-122.329, 47.606, -122.328, 47.607)))
            event = api.CANCELLATIONS[first['id']]
            same = api.start_scan(api.ScanRequest(bbox=(-122.329, 47.606, -122.328, 47.607)))
            self.assertEqual(first['id'], same['id'])
            second = api.start_scan(api.ScanRequest(bbox=(-122.32, 47.61, -122.31, 47.62)))
            self.assertNotEqual(first['id'], second['id'])
            self.assertTrue(event.is_set())
            self.assertEqual(api.get_scan(second['id'])['bbox'], [-122.32, 47.61, -122.31, 47.62])
            api.CANCELLATIONS.clear()

    def test_cancelled_scan_does_not_discover_or_analyze(self):
        from threading import Event
        event = Event()
        event.set()
        api.CANCELLATIONS['test'] = event
        with patch.object(api, 'discover_images') as discovery:
            scan = self.scan()
            api.run_scan(scan, api.ScanRequest())
            self.assertEqual(scan['status'], 'cancelled')
            discovery.assert_not_called()

    def test_oversized_area_rejected(self):
        with self.assertRaises(api.HTTPException) as error:
            api.start_scan(api.ScanRequest(bbox=(-123, 47, -122, 48)))
        self.assertEqual(error.exception.status_code, 422)


if __name__ == '__main__':
    unittest.main()
