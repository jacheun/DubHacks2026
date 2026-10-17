import os
import requests
from dotenv import load_dotenv
from PIL import Image
from io import BytesIO

load_dotenv()

TOKEN = os.getenv("MAPILLARY_TOKEN")

if not TOKEN:
    raise ValueError("Mapillary token not found in .env!")

# Your actual Mapillary image ID
IMAGE_ID = "1302137754488299"

url = f"https://graph.mapillary.com/{IMAGE_ID}"

params = {
    "fields": "id,computed_geometry,captured_at,thumb_1024_url"
}

print("GroundWorkAI: Connecting to Mapillary...")

try:
    response = requests.get(
        url,
        params=params,
        headers={"Authorization": f"OAuth {TOKEN}"},
        timeout=30
    )

    print("Status code:", response.status_code)

    if response.ok:
        data = response.json()

        print("\nImage found!")
        print("Image ID:", data.get("id"))
        print("Coordinates:", data.get("computed_geometry"))
        print("Captured at:", data.get("captured_at"))

        image_url = data.get("thumb_1024_url")

        if image_url:
            image_response = requests.get(
                image_url,
                timeout=30
            )
            image_response.raise_for_status()

            image = Image.open(
                BytesIO(image_response.content)
            )

            image.show()

            print("\nImage loaded successfully!")
        else:
            print("No thumbnail URL returned.")

    else:
        print("Mapillary API error:")
        print(response.text[:1000])

except requests.exceptions.RequestException as e:
    print("Request failed:", e)