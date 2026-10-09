"""Package source and example config only; exclude keys, databases and caches."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from summora.paths import ROOT

SOURCE_FILES = (
    "start_web.cmd",
    "bootstrap.py",
    "requirements.lock.txt",
    "requirements-dev.txt",
    "pyproject.toml",
    ".prettierrc.json",
    ".prettierignore",
    ".env.example",
    ".env.deploy.example",
    ".gitignore",
    ".dockerignore",
    "README.md",
    "Dockerfile",
    "compose.yaml",
)
SOURCE_DIRS = ("summora", "web", "resources", "docs", "deploy", "tests", ".github")
SOURCE_EXTENSIONS = {".py", ".js", ".mjs", ".css", ".html", ".json", ".png", ".ico", ".md", ".yml"}


def build_zip(destination=None):
    destination = Path(destination or ROOT.parent / "summora_web_share.zip").resolve()
    files = [ROOT / name for name in SOURCE_FILES]
    files.append(ROOT / "deploy" / "Caddyfile")
    for name in SOURCE_DIRS:
        files.extend(
            path
            for path in (ROOT / name).rglob("*")
            if path.is_file()
            and path.suffix in SOURCE_EXTENSIONS
            and "__pycache__" not in path.parts
        )
    files = sorted(set(files))
    for path in files:
        if not path.is_file():
            raise FileNotFoundError(f"Missing source file: {path.relative_to(ROOT)}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".zip.tmp")
    with ZipFile(temporary, "w", compression=ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, "summora_web/" + path.relative_to(ROOT).as_posix())
        archive.writestr("summora_web/.env", (ROOT / ".env.example").read_bytes())
    temporary.replace(destination)
    return destination


if __name__ == "__main__":
    print(build_zip())
