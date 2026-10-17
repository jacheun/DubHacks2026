import os
import requests
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("MAPILLARY_TOKEN")

if not TOKEN:
    raise ValueError("Mapillary token not found!")

url = "https://graph.mapillary.com/images"

params = {
    "bbox": "-122.338,47.608,-122.332,47.613",
    "fields": "id,computed_geometry,captured_at,thumb_1024_url",
    "limit": 10
}

response = requests.get(
    url,
    params=params,
    headers={"Authorization": f"OAuth {TOKEN}"},
    timeout=30
)

response.raise_for_status()

images = response.json().get("data", [])

print(f"GroundWorkAI found {len(images)} images!")

for image in images:
    print("Image ID:", image["id"])
    print("Location:", image.get("computed_geometry"))
    print("Image URL:", image.get("thumb_1024_url"))
    print("----------------------")