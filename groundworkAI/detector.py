"""Run the pothole model on a local image or an image downloaded by main.py."""

import argparse
import json
import os
from functools import lru_cache
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = Path(__file__).parent / 'models' / 'best.pt'


@lru_cache(maxsize=1)
def load_model():
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(f'Model weights not found: {MODEL_PATH}')
    # Ultralytics strips apostrophes from weight paths; use a relative path.
    return YOLO(os.path.relpath(MODEL_PATH))


def test_model(source, confidence=0.35, output_dir=None):
    """Predict on one image and save boxes and confidence scores."""
    if not 0 < confidence <= 1:
        raise ValueError('Confidence must be greater than 0 and at most 1.')
    output_dir = Path(output_dir) if output_dir else ROOT / 'runs/model-test'
    result = load_model().predict(source=source, conf=confidence, verbose=False)[0]
    detections = [
        {
            'label': result.names[int(box.cls.item())],
            'confidence': float(box.conf.item()),
            'bbox_xyxy': box.xyxy[0].tolist(),
        }
        for box in result.boxes
    ]
    output_dir.mkdir(parents=True, exist_ok=True)
    result.save(filename=str(output_dir / 'annotated.jpg'))
    report = {
        'image_width': result.orig_shape[1],
        'image_height': result.orig_shape[0],
        'confidence_threshold': confidence,
        'detections': detections,
    }
    (output_dir / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'{len(detections)} detection(s) at confidence >= {confidence}')
    for detection in detections:
        print(f"  {detection['label']}: {detection['confidence']:.2%}")
    print(f'Results saved to: {output_dir}')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    parser.add_argument('--conf', type=float, default=0.35)
    parser.add_argument('--output', type=Path, default=ROOT / 'runs/model-test')
    args = parser.parse_args()
    if not args.image.is_file():
        parser.error(f'Image not found: {args.image}')
    if not 0 < args.conf <= 1:
        parser.error('--conf must be greater than 0 and at most 1')
    test_model(str(args.image), args.conf, args.output)
