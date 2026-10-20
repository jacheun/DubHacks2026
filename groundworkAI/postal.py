"""Cached US ZIP and Canadian postal-code lookup. GEOCODING_API_KEY is a server-only Geocode Maps key."""
import os
import re
import sqlite3
import time
from threading import Lock

import requests
from dotenv import load_dotenv
from settings import ROOT, DATA_DIR

LOCK = Lock()
LAST_REQUEST = 0.0


def lookup_zip(latitude, longitude):
    global LAST_REQUEST
    if latitude is None or longitude is None:
        return ''
    load_dotenv(ROOT / '.env')
    load_dotenv(ROOT / 'groundworkAI/.env')
    token = os.getenv('GEOCODING_API_KEY')
    if not token:
        return ''
    key = f'{latitude:.6f},{longitude:.6f}'
    with LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(DATA_DIR / 'postal.sqlite3') as db:
            db.execute('CREATE TABLE IF NOT EXISTS postal (coordinates TEXT PRIMARY KEY, zip TEXT, checked REAL)')
            cached = db.execute('SELECT zip, checked FROM postal WHERE coordinates=?', (key,)).fetchone()
            if cached and (cached[0] or time.time() - cached[1] < 60):
                return cached[0]
            time.sleep(max(0, 1.1 - (time.monotonic() - LAST_REQUEST)))
            try:
                LAST_REQUEST = time.monotonic()
                response = requests.get('https://geocode.maps.co/reverse',
                    params={'lat': latitude, 'lon': longitude},
                    headers={'Authorization': f'Bearer {token}'}, timeout=10)
                response.raise_for_status()
                address = response.json().get('address', {})
                postal = address.get('postcode', '')
                country = address.get('country_code')
                value = ''
                if country == 'us' and re.fullmatch(r'[0-9]{5}(?:-[0-9]{4})?', postal):
                    value = postal
                elif country == 'ca' and re.fullmatch(r'[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]', postal.upper()):
                    compact = postal.upper().replace(' ', '')
                    value = f'{compact[:3]} {compact[3:]}'
            except (requests.RequestException, ValueError, AttributeError, TypeError):
                value = ''
            db.execute('INSERT OR REPLACE INTO postal VALUES (?, ?, ?)', (key, value, time.time()))
            return value
