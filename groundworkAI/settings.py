"""Shared local and hosted filesystem paths."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv('GROUNDWORK_DATA_DIR', str(ROOT / 'runs'))).resolve()
MODEL_PATH = Path(os.getenv('GROUNDWORK_MODEL_PATH', str(ROOT / 'groundworkAI/models/best.pt'))).resolve()
