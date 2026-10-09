"""Chuẩn bị môi trường Python riêng cho FastAPI."""

import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def prepare():
    if sys.version_info < (3, 10):
        raise RuntimeError("Can Python 3.10 hoac moi hon.")
    if not (ROOT / ".env").is_file():
        shutil.copyfile(ROOT / ".env.example", ROOT / ".env")
    environment = ROOT / ".venv"
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not python.is_file():
        print("Lan dau: dang tao moi truong Python rieng cho ung dung...", flush=True)
        subprocess.run([sys.executable, "-m", "venv", str(environment)], check=True, cwd=ROOT)
    requirements = ROOT / "requirements.lock.txt"
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    stamp = environment / ".requirements.sha256"
    installed = (
        subprocess.run(
            [
                str(python),
                "-c",
                "import openai, dotenv, docx, pypdf, fastapi, uvicorn, multipart, sqlalchemy, psycopg, jwt",
            ],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        == 0
    )
    if not installed or not stamp.is_file() or stamp.read_text(encoding="ascii") != digest:
        print("Dang cai thu vien. Can Internet trong lan chay dau tien...", flush=True)
        subprocess.run(
            [str(python), "-m", "pip", "install", "-r", str(requirements)], check=True, cwd=ROOT
        )
        stamp.write_text(digest, encoding="ascii")
    return python


if __name__ == "__main__":
    try:
        python = prepare()
        print("Dang khoi dong FastAPI tai http://127.0.0.1:8000.", flush=True)
        environment = {**os.environ, "PYTHONPATH": str(ROOT / "services" / "api")}
        result = subprocess.run(
            [
                str(python),
                "-m",
                "uvicorn",
                "summora.api:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            cwd=ROOT / "services" / "api",
            env=environment,
        )
        raise SystemExit(result.returncode)
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError, subprocess.CalledProcessError):
        print(
            "Khong khoi dong duoc. Kiem tra Python, Internet va quyen ghi thu muc. Neu vua chuyen thu muc tu may khac, xoa thu muc .venv roi thu lai.",
            flush=True,
        )
        raise SystemExit(1)
