"""Project paths independent of the caller's working directory."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DATA_DIR = ROOT / "studio_data"
WEB_DIR = ROOT / "web"
RESOURCES_DIR = ROOT / "resources"
