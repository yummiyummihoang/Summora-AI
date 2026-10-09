"""Project paths independent of the caller's working directory."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ENV_PATH = ROOT / ".env"
if not ENV_PATH.is_file():
    web_env = ROOT / "apps" / "web" / ".env.local"
    if web_env.is_file():
        ENV_PATH = web_env
DATA_DIR = ROOT / "studio_data"
RESOURCES_DIR = ROOT / "services" / "api" / "resources"
