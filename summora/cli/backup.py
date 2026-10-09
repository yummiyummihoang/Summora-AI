"""SQLite-consistent private backup and offline restore. Never place backups under web/."""

import argparse
import json
import os
import re
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from summora.paths import DATA_DIR


def backup(directory, destination):
    directory, destination = Path(directory).resolve(), Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        target = Path(temp) / "studio.sqlite3"
        with (
            closing(sqlite3.connect(directory / "studio.sqlite3")) as source,
            closing(sqlite3.connect(target)) as copied,
        ):
            source.backup(copied)
        with closing(sqlite3.connect(target)) as copied:
            if copied.execute(
                "SELECT 1 FROM jobs WHERE status IN ('running','cancelling')"
            ).fetchone():
                raise RuntimeError(
                    "Dừng worker và chờ request hiện tại kết thúc trước khi backup; không sao chép file đang ghi."
                )
            # Sessions are ephemeral credentials; do not keep them in a backup.
            copied.execute("DELETE FROM sessions")
            for row in copied.execute("SELECT id,state FROM jobs WHERE status='queued'").fetchall():
                state = json.loads(row[1])
                state.update(
                    status="cancelled",
                    message="Lượt chờ không tự chạy lại sau phục hồi backup. Tạo lượt mới nếu cần.",
                )
                copied.execute(
                    "UPDATE jobs SET status='cancelled',reserved=0,cancel=1,state=? WHERE id=?",
                    (json.dumps(state, ensure_ascii=False), row[0]),
                )
            copied.commit()
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
            archive.write(target, "studio.sqlite3")
            for path in directory.glob("*.json"):
                archive.write(path, path.name)
        temporary.replace(destination)
    return destination


def restore(archive_path, directory):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise RuntimeError(
            "Phục hồi vào thư mục trống riêng, sau đó kiểm tra trước khi chuyển cấu hình."
        )
    with ZipFile(archive_path) as archive:
        if "studio.sqlite3" not in archive.namelist():
            raise RuntimeError("Backup thiếu database.")
        for member in archive.infolist():
            if (
                not (
                    member.filename == "studio.sqlite3"
                    or re.fullmatch(r"[0-9a-f]{32}\.json", member.filename)
                )
                or member.file_size > 100 * 1024 * 1024
            ):
                raise RuntimeError("Backup có nội dung không hợp lệ.")
        for member in archive.infolist():
            with archive.open(member) as source, (directory / member.filename).open("wb") as target:
                shutil.copyfileobj(source, target)
    with closing(sqlite3.connect(directory / "studio.sqlite3")) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Database phục hồi không hợp lệ.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["backup", "restore"])
    parser.add_argument("archive")
    parser.add_argument("--data", default=os.environ.get("STUDIO_DATA_DIR", DATA_DIR))
    args = parser.parse_args()
    if args.action == "backup":
        print(backup(args.data, args.archive))
    else:
        restore(args.archive, args.data)
        print("Da phuc hoi. Kiem tra du lieu truoc khi chuyen ung dung sang thu muc nay.")
