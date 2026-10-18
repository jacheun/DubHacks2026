"""Discover imagery using Mapillary's zoom-14 coverage vector tiles."""
import math

import mapbox_vector_tile
import requests


def tile_xy(longitude, latitude, zoom=14):
    n = 2 ** zoom
    latitude = max(-85.051128, min(85.051128, latitude))
    radians = math.radians(latitude)
    return (min(n - 1, max(0, int((longitude + 180) / 360 * n))),
            min(n - 1, max(0, int((1 - math.asinh(math.tan(radians)) / math.pi) / 2 * n))))


def discover_images(bbox, token):
    west, south, east, north = bbox
    left, top = tile_xy(west, north)
    right, bottom = tile_xy(east, south)
    if (right - left + 1) * (bottom - top + 1) > 16:
        raise ValueError('Zoom in to a neighborhood before scanning (maximum 16 coverage tiles).')
    candidates = {}
    with requests.Session() as session:
        for x in range(left, right + 1):
            for y in range(top, bottom + 1):
                response = session.get(
                    f'https://tiles.mapillary.com/maps/vtp/mly1_public/2/14/{x}/{y}',
                    params={'access_token': token}, timeout=30,
                )
                if response.status_code == 204:
                    continue
                if not response.ok:
                    raise ValueError(f'Mapillary coverage request failed (HTTP {response.status_code}).')
                if not response.content:
                    continue
                # Decode with top-left origin, matching slippy-map tile coordinates.
                layers = mapbox_vector_tile.decode(response.content, default_options={'y_coord_down': True})
                layer = layers.get('image', {})
                extent = layer.get('extent', 4096)
                for feature in layer.get('features', []):
                    properties = feature.get('properties', {})
                    image_id = str(properties.get('id', ''))
                    geometry = feature.get('geometry', {})
                    if not image_id.isdecimal() or geometry.get('type') != 'Point':
                        continue
                    px, py = geometry['coordinates'][:2]
                    longitude = (x + px / extent) / 2**14 * 360 - 180
                    latitude = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / extent) / 2**14))))
                    if west <= longitude <= east and south <= latitude <= north:
                        candidates[image_id] = {
                            'id': image_id, 'latitude': latitude, 'longitude': longitude,
                            'captured_at': properties.get('captured_at', 0),
                        }
    # Prefer recent images, sampling across the area rather than one sequence.
    ordered = sorted(candidates.values(), key=lambda item: item['captured_at'], reverse=True)
    cells = {}
    for item in ordered:
        cell = (round(item['latitude'], 3), round(item['longitude'], 3))
        cells.setdefault(cell, []).append(item['id'])
    result = []
    while cells:
        for cell in list(cells):
            result.append(cells[cell].pop(0))
            if not cells[cell]:
                del cells[cell]
    return result
