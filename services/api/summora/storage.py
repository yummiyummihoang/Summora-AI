"""Supabase Postgres storage for drafts, prompt libraries, quotas, and durable jobs."""

import hashlib
import json
import os
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from summora.paths import ENV_PATH


def encode(value):
    return json.dumps(value, ensure_ascii=False)


def _json(value):
    if isinstance(value, str):
        return json.loads(value)
    return value


class Store:
    def __init__(self, directory=None, quota=200, global_quota=1000, database_url=None):
        load_dotenv(ENV_PATH, override=False)
        self.directory = Path(directory or os.environ.get("STUDIO_DATA_DIR", "studio_data"))
        self.directory.mkdir(parents=True, exist_ok=True)
        self.quota = quota
        self.global_quota = global_quota
        # The API and worker need a stable PostgreSQL session for advisory locks.
        # Prefer Prisma's direct/session-mode URL over its transaction-pool URL.
        url = database_url or os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("Cần cấu hình DATABASE_URL trỏ tới Supabase PostgreSQL.")
        parsed_url = make_url(url)
        if parsed_url.drivername in {"postgres", "postgresql"}:
            parsed_url = parsed_url.set(drivername="postgresql+psycopg")
        # `pgbouncer=true` is a Prisma hint, not a libpq connection option.
        if "pgbouncer" in parsed_url.query:
            query = dict(parsed_url.query)
            query.pop("pgbouncer", None)
            parsed_url = parsed_url.set(query=query)
        self.engine = create_engine(parsed_url, pool_pre_ping=True, pool_recycle=300)

    @contextmanager
    def connection(self):
        """Compatibility context for internal SQL; callers should use Store methods."""
        with self.engine.begin() as db:
            yield db

    def prompts(self, owner):
        with self.engine.connect() as db:
            row = (
                db.execute(text("SELECT body FROM prompts WHERE owner=:owner"), {"owner": owner})
                .mappings()
                .first()
            )
        return _json(row["body"]) if row else []

    def save_prompts(self, owner, body):
        with self.engine.begin() as db:
            db.execute(
                text("""INSERT INTO prompts(owner,body) VALUES(:owner,CAST(:body AS jsonb))
                ON CONFLICT(owner) DO UPDATE SET body=EXCLUDED.body"""),
                {"owner": owner, "body": encode(body)},
            )

    def heartbeat(self):
        with self.engine.connect() as db:
            row = db.execute(text("SELECT heartbeat FROM worker WHERE id=1")).first()
        return row[0] if row else None

    def health(self):
        with self.engine.connect() as db:
            db.execute(text("SELECT 1"))
            return self.heartbeat()

    def rate_limit(self, key, maximum, seconds):
        with self.engine.begin() as db:
            db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"), {"key": key})
            row = (
                db.execute(
                    text("SELECT count,expires FROM limits WHERE key=:key FOR UPDATE"), {"key": key}
                )
                .mappings()
                .first()
            )
            now = time.time()
            if row and row["expires"] > now and row["count"] >= maximum:
                raise ValueError("Thao tác quá nhanh. Vui lòng thử lại sau.")
            if row and row["expires"] > now:
                db.execute(text("UPDATE limits SET count=count+1 WHERE key=:key"), {"key": key})
            else:
                db.execute(
                    text("""INSERT INTO limits(key,count,expires) VALUES(:key,1,:expires)
                    ON CONFLICT(key) DO UPDATE SET count=1,expires=EXCLUDED.expires"""),
                    {"key": key, "expires": now + seconds},
                )

    def save_draft(self, owner, body):
        with self.engine.begin() as db:
            db.execute(
                text("""INSERT INTO drafts(owner,body,updated) VALUES(:owner,CAST(:body AS jsonb),:updated)
                ON CONFLICT(owner) DO UPDATE SET body=EXCLUDED.body,updated=EXCLUDED.updated"""),
                {"owner": owner, "body": encode(body), "updated": time.time()},
            )

    def draft(self, owner):
        with self.engine.connect() as db:
            row = (
                db.execute(
                    text("SELECT body,updated FROM drafts WHERE owner=:owner"), {"owner": owner}
                )
                .mappings()
                .first()
            )
        return {"draft": _json(row["body"]), "updated": row["updated"]} if row else {"draft": None}

    def usage(self, owner):
        day = time.strftime("%Y-%m-%d", time.gmtime())
        with self.engine.connect() as db:
            used = db.execute(
                text(
                    "SELECT COALESCE(SUM(reserved+charged),0) FROM jobs WHERE owner=:owner AND day=:day"
                ),
                {"owner": owner, "day": day},
            ).scalar_one()
            limit = db.execute(
                text("SELECT daily_quota FROM profiles WHERE user_id=:owner"), {"owner": owner}
            ).scalar_one_or_none()
        limit = limit or self.quota
        return {
            "used": int(used),
            "limit": limit,
            "remaining": max(0, limit - int(used)),
            "day": day,
        }

    def submit(self, owner, body, documents, tasks, idem):
        digest = hashlib.sha256(encode(body).encode()).hexdigest()
        day = time.strftime("%Y-%m-%d", time.gmtime())
        now = time.time()
        with self.engine.begin() as db:
            db.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                {"key": f"owner:{owner}:{day}"},
            )
            old = (
                db.execute(
                    text("SELECT id,digest,deleted FROM jobs WHERE owner=:owner AND idem=:idem"),
                    {"owner": owner, "idem": idem},
                )
                .mappings()
                .first()
            )
            if old:
                if old["deleted"]:
                    raise ValueError("Lượt gắn với mã yêu cầu này đã bị xóa.")
                if old["digest"] != digest:
                    raise ValueError("Mã yêu cầu đã được dùng với nội dung khác.")
                return old["id"]
            if db.execute(
                text(
                    "SELECT 1 FROM jobs WHERE owner=:owner AND status IN ('queued','running','cancelling') AND NOT deleted LIMIT 1"
                ),
                {"owner": owner},
            ).first():
                raise ValueError("Bạn có một lượt đang chạy hoặc đang chờ.")
            profile_quota = db.execute(
                text("SELECT daily_quota FROM profiles WHERE user_id=:owner"), {"owner": owner}
            ).scalar_one_or_none()
            quota = profile_quota or self.quota
            used = db.execute(
                text(
                    "SELECT COALESCE(SUM(reserved+charged),0) FROM jobs WHERE owner=:owner AND day=:day"
                ),
                {"owner": owner, "day": day},
            ).scalar_one()
            if used + len(tasks) > quota:
                raise ValueError("Lượt này vượt hạn mức tác vụ trong ngày.")
            db.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                {"key": f"global:{day}"},
            )
            total = db.execute(
                text("SELECT COALESCE(SUM(reserved+charged),0) FROM jobs WHERE day=:day"),
                {"day": day},
            ).scalar_one()
            if total + len(tasks) > self.global_quota:
                raise ValueError(
                    "Hệ thống đã chạm hạn mức tác vụ hôm nay. Thử lại vào ngày mai (UTC)."
                )
            job_id = uuid4().hex
            state = {
                "id": job_id,
                "created": now,
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
                text("""INSERT INTO jobs(id,owner,idem,digest,status,body,state,created,day,reserved)
                VALUES(:id,:owner,:idem,:digest,'queued',CAST(:body AS jsonb),CAST(:state AS jsonb),:created,:day,:reserved)"""),
                {
                    "id": job_id,
                    "owner": owner,
                    "idem": idem,
                    "digest": digest,
                    "body": encode(body),
                    "state": encode(state),
                    "created": now,
                    "day": day,
                    "reserved": len(tasks),
                },
            )
            return job_id

    def job(self, owner, job_id):
        with self.engine.connect() as db:
            row = (
                db.execute(
                    text("SELECT state FROM jobs WHERE id=:id AND owner=:owner AND NOT deleted"),
                    {"id": job_id, "owner": owner},
                )
                .mappings()
                .first()
            )
        if not row:
            raise KeyError(job_id)
        return _json(row["state"])

    def history(self, owner):
        with self.engine.connect() as db:
            rows = (
                db.execute(
                    text(
                        "SELECT id,state,created FROM jobs WHERE owner=:owner AND NOT deleted ORDER BY created DESC LIMIT 200"
                    ),
                    {"owner": owner},
                )
                .mappings()
                .all()
            )
        result = []
        for row in rows:
            state = _json(row["state"])
            result.append(
                {
                    "id": row["id"],
                    "created": row["created"],
                    **{key: state[key] for key in ("status", "total", "done", "success", "errors")},
                    "title": state["documents"][0]["title"],
                    "documents": len(state["documents"]),
                }
            )
        return result

    def cancel(self, owner, job_id):
        with self.engine.begin() as db:
            row = (
                db.execute(
                    text(
                        "SELECT status,state FROM jobs WHERE id=:id AND owner=:owner AND NOT deleted FOR UPDATE"
                    ),
                    {"id": job_id, "owner": owner},
                )
                .mappings()
                .first()
            )
            if not row:
                raise KeyError(job_id)
            state = _json(row["state"])
            if row["status"] == "queued":
                state.update(status="cancelled", message="Đã hủy trước khi gửi API.")
                db.execute(
                    text(
                        "UPDATE jobs SET status='cancelled',state=CAST(:state AS jsonb),cancel=true,reserved=0 WHERE id=:id"
                    ),
                    {"state": encode(state), "id": job_id},
                )
            elif row["status"] in {"running", "cancelling"}:
                state.update(
                    status="cancelling", message="Đang dừng; chờ request hiện tại kết thúc."
                )
                db.execute(
                    text(
                        "UPDATE jobs SET status='cancelling',state=CAST(:state AS jsonb),cancel=true WHERE id=:id"
                    ),
                    {"state": encode(state), "id": job_id},
                )

    def delete(self, owner, job_id):
        state = self.job(owner, job_id)
        if state["status"] in {"queued", "running", "cancelling"}:
            raise ValueError("Dừng lượt chạy trước khi xóa.")
        with self.engine.begin() as db:
            db.execute(
                text(
                    "UPDATE jobs SET deleted=true,body='{}'::jsonb,state='{}'::jsonb WHERE id=:id AND owner=:owner"
                ),
                {"id": job_id, "owner": owner},
            )
        (self.directory / (job_id + ".json")).unlink(missing_ok=True)

    def recover(self):
        with self.engine.begin() as db:
            rows = (
                db.execute(
                    text(
                        "SELECT id,state FROM jobs WHERE status IN ('running','cancelling') FOR UPDATE"
                    )
                )
                .mappings()
                .all()
            )
            for row in rows:
                state = _json(row["state"])
                path = self.directory / (row["id"] + ".json")
                if path.is_file():
                    try:
                        exported = json.loads(path.read_text(encoding="utf-8"))
                        known = {result["task_id"] for result in state["results"]}
                        for doc in exported["data"]:
                            for entry in doc["generated_summaries"]:
                                if entry["task_id"] not in known:
                                    state["results"].append({"title": doc["title"], **entry})
                                    known.add(entry["task_id"])
                        state["done"] = len(state["results"])
                        state["success"] = sum(
                            result["status"] == "success" for result in state["results"]
                        )
                        state["errors"] = state["done"] - state["success"]
                        state["download_ready"] = True
                    except (ValueError, KeyError, OSError):
                        pass
                completed = {result["task_id"]: result["status"] for result in state["results"]}
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
                    text(
                        "UPDATE jobs SET status='interrupted',state=CAST(:state AS jsonb),reserved=0 WHERE id=:id"
                    ),
                    {"state": encode(state), "id": row["id"]},
                )

    def claim(self):
        with self.engine.begin() as db:
            row = (
                db.execute(
                    text(
                        "SELECT id,state FROM jobs WHERE status='queued' AND NOT deleted ORDER BY created FOR UPDATE SKIP LOCKED LIMIT 1"
                    )
                )
                .mappings()
                .first()
            )
            db.execute(
                text(
                    "INSERT INTO worker(id,heartbeat) VALUES(1,:heartbeat) ON CONFLICT(id) DO UPDATE SET heartbeat=EXCLUDED.heartbeat"
                ),
                {"heartbeat": time.time()},
            )
            if not row:
                return None
            state = _json(row["state"])
            state.update(status="running", message="Đang bắt đầu…")
            db.execute(
                text("UPDATE jobs SET status='running',state=CAST(:state AS jsonb) WHERE id=:id"),
                {"state": encode(state), "id": row["id"]},
            )
            return state

    def prune(self, days=30):
        before = time.time() - days * 86400
        with self.engine.begin() as db:
            rows = (
                db.execute(
                    text(
                        "UPDATE jobs SET deleted=true,body='{}'::jsonb,state='{}'::jsonb WHERE created<:before AND NOT deleted AND status NOT IN ('queued','running','cancelling') RETURNING id"
                    ),
                    {"before": before},
                )
                .scalars()
                .all()
            )
            db.execute(text("DELETE FROM drafts WHERE updated<:before"), {"before": before})
            db.execute(text("DELETE FROM limits WHERE expires<:now"), {"now": time.time()})
        for job_id in rows:
            (self.directory / (job_id + ".json")).unlink(missing_ok=True)

    def update(self, state, charge=False, final=False):
        with self.engine.begin() as db:
            row = (
                db.execute(
                    text("SELECT cancel FROM jobs WHERE id=:id FOR UPDATE"), {"id": state["id"]}
                )
                .mappings()
                .first()
            )
            if not row:
                return
            if row["cancel"] and not final:
                state["status"] = "cancelling"
            db.execute(
                text("""UPDATE jobs SET status=:status,state=CAST(:state AS jsonb),charged=charged+:charge,
                reserved=CASE WHEN :final THEN 0 ELSE GREATEST(0,reserved-:charge) END WHERE id=:id"""),
                {
                    "status": state["status"],
                    "state": encode(state),
                    "charge": int(charge),
                    "final": final,
                    "id": state["id"],
                },
            )

    def stopped(self, job_id):
        with self.engine.connect() as db:
            value = db.execute(
                text("SELECT cancel FROM jobs WHERE id=:id"), {"id": job_id}
            ).scalar_one_or_none()
        return bool(value)
