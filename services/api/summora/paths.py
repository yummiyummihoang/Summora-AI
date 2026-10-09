"""Project paths independent of the caller's working directory."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ENV_PATH = ROOT / ".env"
DATA_DIR = ROOT / "studio_data"
RESOURCES_DIR = ROOT / "services" / "api" / "resources"
