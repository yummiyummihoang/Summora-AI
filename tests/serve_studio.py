"""Temporary UI test fixture. Fake provider only; never reads the user's provider keys."""

import argparse
import tempfile
from pathlib import Path

import uvicorn

from summora.api import create_app
from tests.helpers import PreviewClient

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=52636)
    parser.add_argument("--delay", type=float, default=0.1)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="studio-preview-") as directory:
        root = Path(directory)
        config = root / ".env"
        config.write_text(
            "OPENAI_API_KEY=test-only\nOPENAI_MODELS=mock-model\nDEEPSEEK_API_KEY=test-only\nDEEPSEEK_MODELS=mock-other\n",
            encoding="utf-8",
        )
        uvicorn.run(
            create_app(
                root / "data", env_path=config, client_factory=lambda *_: PreviewClient(args.delay)
            ),
            host="127.0.0.1",
            port=args.port,
            access_log=False,
        )
