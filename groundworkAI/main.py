"""Find Mapillary images in an area and test them with the local YOLO model."""

import argparse
import json
import os
from io import BytesIO
from pathlib import Path

import requests
from dotenv import load_dotenv
from PIL import Image

from detector import test_model

ROOT = Path(__file__).resolve().parents[1]
FIELDS = 'id,computed_geometry,captured_at,thumb_1024_url'


def fetch_json(session, endpoint, token, params):
    response = session.get(
        f'https://graph.mapillary.com/{endpoint}',
        headers={'Authorization': f'OAuth {token}'},
        params=params,
        timeout=30,
    )
    if not response.ok:
        message = ''
        try:
            message = response.json().get('error', {}).get('message', '')
        except ValueError:
            pass
        # Never expose signed URLs or the access token in error output.
        if 'reduce the amount of data' in message.lower():
            raise ValueError(
                f'Mapillary API returned HTTP {response.status_code}: '
                'the area search exceeded its query capacity. '
                'A smaller result limit may not help; try another area or '
                'use --image-id to test a known image.'
            )
        raise ValueError(f'Mapillary API returned HTTP {response.status_code}.')
    return response.json()


def process_image(session, metadata, confidence):
    image_id = str(metadata['id'])
    image_url = metadata.get('thumb_1024_url')
    if not image_url:
        raise ValueError('No thumbnail URL returned.')
    response = session.get(image_url, timeout=60)
    if not response.ok:
        raise ValueError(f'Image download returned HTTP {response.status_code}.')
    image = Image.open(BytesIO(response.content)).convert('RGB')
    output = ROOT / 'runs/mapillary' / image_id
    output.mkdir(parents=True, exist_ok=True)
    image.save(output / 'original.jpg')
    print(f'\nTesting Mapillary image {image_id}')
    report = test_model(image, confidence=confidence, output_dir=output)
    coordinates = (metadata.get('computed_geometry') or {}).get('coordinates')
    report.update({
        'source': 'mapillary',
        'source_image_id': image_id,
        'captured_at': metadata.get('captured_at'),
        'camera_location': (
            {'longitude': coordinates[0], 'latitude': coordinates[1]}
            if coordinates and len(coordinates) >= 2 else None
        ),
        'location_accuracy': 'approximate' if coordinates else 'unknown',
    })
    (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image-id', help='Optional: test one specific image instead of searching')
    parser.add_argument('--bbox', nargs=4, type=float,
                        default=[-122.335, 47.602, -122.325, 47.612],
                        metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'),
                        help='Search area in longitude/latitude; defaults to downtown Seattle')
    parser.add_argument('--limit', type=int, default=5, help='Maximum images per run (1–100)')
    parser.add_argument('--conf', type=float, default=0.35)
    args = parser.parse_args()
    if args.image_id and not args.image_id.isdecimal():
        parser.error('--image-id must contain only digits')
    if not 0 < args.conf <= 1 or not 1 <= args.limit <= 100:
        parser.error('Use confidence in (0, 1] and limit in [1, 100]')
    west, south, east, north = args.bbox
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        parser.error('Invalid bbox: use west south east north')
    load_dotenv(ROOT / '.env')
    load_dotenv(Path(__file__).parent / '.env')
    token = os.getenv('MAPILLARY_TOKEN')
    if not token:
        parser.exit(1, 'Set MAPILLARY_TOKEN in .env.\n')
    try:
        with requests.Session() as session:
            if args.image_id:
                images = [fetch_json(session, args.image_id, token, {'fields': FIELDS})]
            else:
                result = fetch_json(session, 'images', token, {
                    'fields': FIELDS,
                    'bbox': ','.join(map(str, args.bbox)),
                    'limit': args.limit,
                })
                images = result.get('data', [])[:args.limit]
                print(f'Found {len(images)} image(s) in the search area.')
                if not images:
                    print('Try a different --bbox area.')
            failures = 0
            for metadata in images:
                try:
                    process_image(session, metadata, args.conf)
                except (requests.RequestException, ValueError, OSError):
                    failures += 1
                    print(f"Could not process image {metadata.get('id')}; continuing.")
            if failures:
                parser.exit(1, f'{failures} image(s) failed.\n')
    except requests.RequestException:
        parser.exit(1, 'Network request failed. Check connectivity and retry.\n')
    except ValueError as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
