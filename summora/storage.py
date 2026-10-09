"""Private SQLite storage and transactional job reservations (one worker per deployment)."""

import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4


def encode(value):
    return json.dumps(value, ensure_ascii=False)


def password_hash(password, salt=None):
    if not isinstance(password, str) or not 12 <= len(password) <= 256:
        raise ValueError("Mật khẩu cần 12–256 ký tự.")
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return salt + ":" + digest


class Store:
    def __init__(self, directory, quota=200, global_quota=1000):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "studio.sqlite3"
        self.quota = quota
        self.global_quota = global_quota
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE,password TEXT,role TEXT);
                CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT,csrf TEXT,expires REAL);
                CREATE TABLE IF NOT EXISTS drafts(owner TEXT PRIMARY KEY,body TEXT,updated REAL);
                CREATE TABLE IF NOT EXISTS prompts(owner TEXT PRIMARY KEY,body TEXT);
                CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT,idem TEXT,digest TEXT,status TEXT,
                    body TEXT,state TEXT,created REAL,day TEXT,reserved INTEGER,charged INTEGER DEFAULT 0,
                    cancel INTEGER DEFAULT 0,deleted INTEGER DEFAULT 0, UNIQUE(owner,idem));
                CREATE TABLE IF NOT EXISTS worker(id INTEGER PRIMARY KEY,heartbeat REAL);
                CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER,expires REAL);
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def add_user(self, email, password, role="member"):
        email = str(email).strip().lower()
        if not email or len(email) > 254 or "@" not in email:
            raise ValueError("Email không hợp lệ.")
        with self.connection() as db:
            db.execute(
                "INSERT INTO users VALUES(?,?,?,?)",
                (uuid4().hex, email, password_hash(password), role),
            )

    def login(self, email, password):
        with self.connection() as db:
            user = db.execute(
                "SELECT * FROM users WHERE email=?", (str(email).strip().lower(),)
            ).fetchone()
            stored = (
                user["password"] if user else password_hash("dummy-password-for-timing", "00" * 16)
            )
            try:
                valid = hmac.compare_digest(password_hash(password, stored.split(":")[0]), stored)
            except ValueError:
                valid = False
            if not user or not valid:
                raise ValueError("Email hoặc mật khẩu không đúng.")
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
            db.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
            db.execute(
                "INSERT INTO sessions VALUES(?,?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), user["id"], csrf, time.time() + 86400),
            )
            return token, csrf

    def session(self, token):
        with self.connection() as db:
            row = db.execute(
                "SELECT u.id,u.email,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=? AND expires>?",
                (hashlib.sha256(token.encode()).hexdigest(), time.time()),
            ).fetchone()
            return dict(row) if row else None

    def logout(self, token):
        with self.connection() as db:
            db.execute(
                "DELETE FROM sessions WHERE token=?", (hashlib.sha256(token.encode()).hexdigest(),)
            )

    def rate_limit(self, key, maximum, seconds):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM limits WHERE expires<?", (time.time(),))
            row = db.execute("SELECT * FROM limits WHERE key=?", (key,)).fetchone()
            if row and row["count"] >= maximum:
                raise ValueError("Thao tác quá nhanh. Vui lòng thử lại sau.")
            db.execute(
                "INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
                (key, time.time() + seconds),
            )

    def save_draft(self, owner, body):
        with self.connection() as db:
            db.execute(
                "INSERT INTO drafts VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body,updated=excluded.updated",
                (owner, encode(body), time.time()),
            )

    def draft(self, owner):
        with self.connection() as db:
            row = db.execute("SELECT * FROM drafts WHERE owner=?", (owner,)).fetchone()
            return (
                {"draft": json.loads(row["body"]), "updated": row["updated"]}
                if row
                else {"draft": None}
            )

    def usage(self, owner):
        day = time.strftime("%Y-%m-%d", time.gmtime())
        with self.connection() as db:
            used = db.execute(
                "SELECT COALESCE(SUM(reserved+charged),0) FROM jobs WHERE owner=? AND day=?",
                (owner, day),
            ).fetchone()[0]
        return {
            "used": used,
            "limit": self.quota,
            "remaining": max(0, self.quota - used),
            "day": day,
        }

    def submit(self, owner, body, documents, tasks, idem):
        digest = hashlib.sha256(encode(body).encode()).hexdigest()
        day = time.strftime("%Y-%m-%d", time.gmtime())
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute(
                "SELECT * FROM jobs WHERE owner=? AND idem=?", (owner, idem)
            ).fetchone()
            if old:
                if old["deleted"]:
                    raise ValueError("Lượt gắn với mã yêu cầu này đã bị xóa.")
                if old["digest"] != digest:
                    raise ValueError("Mã yêu cầu đã được dùng với nội dung khác.")
                return old["id"]
            if db.execute(
                "SELECT 1 FROM jobs WHERE owner=? AND status IN ('queued','running','cancelling')",
                (owner,),
            ).fetchone():
                raise ValueError("Bạn có một lượt đang chạy hoặc đang chờ.")
            used = db.execute(
                "SELECT COALESCE(SUM(reserved+charged),0) FROM jobs WHERE owner=? AND day=?",
                (owner, day),
            ).fetchone()[0]
            if used + len(tasks) > self.quota:
                raise ValueError("Lượt này vượt hạn mức tác vụ trong ngày.")
            total = db.execute(
                "SELECT COALESCE(SUM(reserved+charged),0) FROM jobs WHERE day=?", (day,)
            ).fetchone()[0]
            if total + len(tasks) > self.global_quota:
                raise ValueError(
                    "Hệ thống đã chạm hạn mức tác vụ hôm nay. Thử lại vào ngày mai (UTC)."
                )
            job_id = uuid4().hex
            state = {
                "id": job_id,
                "created": time.time(),
                "status": "queued",
                "total": len(tasks),
                "done": 0,
                "success": 0,
                "errors": 0,
                "documents": documents,
                "tasks": tasks,
                "results": [],
                "message": "Đang chờ xử lý.",
                "download_ready": False,
            }
            db.execute(
                "INSERT INTO jobs(id,owner,idem,digest,status,body,state,created,day,reserved) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    job_id,
                    owner,
                    idem,
                    digest,
                    "queued",
                    encode(body),
                    encode(state),
                    time.time(),
                    day,
                    len(tasks),
                ),
            )
            return job_id

    def job(self, owner, job_id):
        with self.connection() as db:
            row = db.execute(
                "SELECT * FROM jobs WHERE id=? AND owner=? AND deleted=0", (job_id, owner)
            ).fetchone()
            if not row:
                raise KeyError(job_id)
            return json.loads(row["state"])

    def history(self, owner):
        with self.connection() as db:
            rows = db.execute(
                "SELECT id,state,created FROM jobs WHERE owner=? AND deleted=0 ORDER BY created DESC LIMIT 200",
                (owner,),
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "created": r["created"],
                    **{k: s[k] for k in ("status", "total", "done", "success", "errors")},
                    "title": s["documents"][0]["title"],
                    "documents": len(s["documents"]),
                }
                for r in rows
                for s in [json.loads(r["state"])]
            ]

    def cancel(self, owner, job_id):
        self.job(owner, job_id)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM jobs WHERE id=? AND owner=?", (job_id, owner)
            ).fetchone()
            state = json.loads(row["state"])
            if row["status"] == "queued":
                state.update(status="cancelled", message="Đã hủy trước khi gửi API.")
                db.execute(
                    "UPDATE jobs SET status='cancelled',state=?,cancel=1,reserved=0 WHERE id=?",
                    (encode(state), job_id),
                )
            elif row["status"] in {"running", "cancelling"}:
                state.update(
                    status="cancelling", message="Đang dừng; chờ request hiện tại kết thúc."
                )
                db.execute(
                    "UPDATE jobs SET status='cancelling',state=?,cancel=1 WHERE id=?",
                    (encode(state), job_id),
                )

    def delete(self, owner, job_id):
        state = self.job(owner, job_id)
        if state["status"] in {"queued", "running", "cancelling"}:
            raise ValueError("Dừng lượt chạy trước khi xóa.")
        # Preserve only quota accounting and idempotency metadata; remove source/results permanently.
        with self.connection() as db:
            db.execute(
                "UPDATE jobs SET deleted=1,body='{}',state='{}' WHERE id=? AND owner=?",
                (job_id, owner),
            )
        (self.directory / (job_id + ".json")).unlink(missing_ok=True)

    def recover(self):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            for row in db.execute(
                "SELECT * FROM jobs WHERE status IN ('running','cancelling')"
            ).fetchall():
                state = json.loads(row["state"])
                path = self.directory / (row["id"] + ".json")
                if path.is_file():
                    try:
                        exported = json.loads(path.read_text(encoding="utf-8"))
                        known = {r["task_id"] for r in state["results"]}
                        for doc in exported["data"]:
                            for entry in doc["generated_summaries"]:
                                if entry["task_id"] not in known:
                                    state["results"].append({"title": doc["title"], **entry})
                                    known.add(entry["task_id"])
                        state["done"] = len(state["results"])
                        state["success"] = sum(r["status"] == "success" for r in state["results"])
                        state["errors"] = state["done"] - state["success"]
                        state["download_ready"] = True
                    except (ValueError, KeyError, OSError):
                        pass
                completed = {r["task_id"]: r["status"] for r in state["results"]}
                for task in state["tasks"]:
                    if task["id"] in completed:
                        task["status"] = completed[task["id"]]
                    elif task["status"] == "running":
                        task["status"] = "unknown"
                state.update(
                    status="interrupted",
                    message="Worker đã khởi động lại. Request đang gửi có trạng thái chưa xác định; không tự động gửi lại.",
                )
                db.execute(
                    "UPDATE jobs SET status='interrupted',state=?,reserved=0 WHERE id=?",
                    (encode(state), row["id"]),
                )

    def claim(self):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1"
            ).fetchone()
            db.execute(
                "INSERT INTO worker VALUES(1,?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat",
                (time.time(),),
            )
            if not row:
                return None
            state = json.loads(row["state"])
            state.update(status="running", message="Đang bắt đầu…")
            db.execute(
                "UPDATE jobs SET status='running',state=? WHERE id=?", (encode(state), row["id"])
            )
            return state

    def prune(self, days=30):
        """Clear private content after configurable inactivity; keep task counters for quota."""
        before = time.time() - days * 86400
        with self.connection() as db:
            ids = [
                r[0]
                for r in db.execute(
                    "SELECT id FROM jobs WHERE created<? AND deleted=0 AND status NOT IN ('queued','running','cancelling')",
                    (before,),
                )
            ]
            db.execute(
                "UPDATE jobs SET deleted=1,body='{}',state='{}' WHERE created<? AND status NOT IN ('queued','running','cancelling')",
                (before,),
            )
            db.execute("DELETE FROM drafts WHERE updated<?", (before,))
            db.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
        for job_id in ids:
            (self.directory / (job_id + ".json")).unlink(missing_ok=True)

    def update(self, state, charge=False, final=False):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT cancel FROM jobs WHERE id=?", (state["id"],)).fetchone()
            if row["cancel"] and not final:
                state["status"] = "cancelling"
            db.execute(
                "UPDATE jobs SET status=?,state=?,charged=charged+?,reserved=CASE WHEN ? THEN 0 ELSE MAX(0,reserved-?) END WHERE id=?",
                (state["status"], encode(state), int(charge), int(final), int(charge), state["id"]),
            )

    def stopped(self, job_id):
        with self.connection() as db:
            return bool(db.execute("SELECT cancel FROM jobs WHERE id=?", (job_id,)).fetchone()[0])
