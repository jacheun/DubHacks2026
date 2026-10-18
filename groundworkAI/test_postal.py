import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import postal


class PostalTests(unittest.TestCase):
    def test_lookup_is_cached_and_uses_server_header(self):
        response = Mock()
        response.json.return_value = {'address': {'postcode': '98101', 'country_code': 'us'}}
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(postal, 'DATA_DIR', Path(directory)), \
             patch.dict('os.environ', {'GEOCODING_API_KEY': 'test-key'}), \
             patch.object(postal, 'load_dotenv'), \
             patch.object(postal.time, 'sleep'), \
             patch.object(postal.requests, 'get', return_value=response) as get:
            self.assertEqual(postal.lookup_zip(47.6067, -122.3287), '98101')
            self.assertEqual(postal.lookup_zip(47.6067, -122.3287), '98101')
            self.assertEqual(get.call_count, 1)
            self.assertNotIn('api_key', get.call_args.kwargs['params'])

    def test_failure_does_not_fail_report_and_is_cached(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(postal, 'DATA_DIR', Path(directory)), \
             patch.dict('os.environ', {'GEOCODING_API_KEY': 'test-key'}), \
             patch.object(postal, 'load_dotenv'), \
             patch.object(postal.time, 'sleep'), \
             patch.object(postal.requests, 'get', side_effect=postal.requests.Timeout) as get:
            self.assertEqual(postal.lookup_zip(47.6, -122.3), '')
            self.assertEqual(postal.lookup_zip(47.6, -122.3), '')
            self.assertEqual(get.call_count, 1)
