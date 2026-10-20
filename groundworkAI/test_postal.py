"""Postal lookup regression checks, with no network calls."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import postal


class PostalTests(unittest.TestCase):
    def test_us_and_canadian_codes_are_preserved(self):
        cases = [('us', '98101', '98101'), ('us', '98101-1234', '98101-1234'),
                 ('ca', 'V3M 3T2', 'V3M 3T2'), ('ca', 'v3m3t2', 'V3M 3T2'),
                 ('us', 'invalid', ''), ('ca', 'invalid', '')]
        for country, code, expected in cases:
            with self.subTest(country=country, code=code), tempfile.TemporaryDirectory() as directory:
                response = Mock()
                response.json.return_value = {'address': {'country_code': country, 'postcode': code}}
                with patch.object(postal, 'DATA_DIR', Path(directory)), \
                     patch.dict('os.environ', {'GEOCODING_API_KEY': 'test'}), \
                     patch.object(postal.requests, 'get', return_value=response), \
                     patch.object(postal.time, 'sleep'):
                    self.assertEqual(postal.lookup_zip(49.2, -122.9), expected)
