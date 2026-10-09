"""FastAPI application: local workspace or authenticated single-host beta deployment."""

import hashlib
import hmac
import json
import os
import secrets
import threading
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from summora.config import ENV_PATH, public_provider_configs, read_provider_configs
from summora.documents import import_document
from summora.formats import parse_prompts
from summora.paths import DATA_DIR, RESOURCES_DIR, WEB_DIR
from summora.storage import Store, encode
from summora.tasks import normalize_payload
from summora.worker import loop

MAX_BODY = 25 * 1024 * 1024


def create_app(
    directory=None, mode=None, embedded_worker=None, env_path=ENV_PATH, client_factory=None
):
    mode = mode or os.environ.get("STUDIO_MODE", "local")
    if mode not in {"local", "online"}:
        raise RuntimeError("STUDIO_MODE phải là local hoặc online.")
    origin = os.environ.get("STUDIO_ORIGIN", "").rstrip("/")
    if mode == "online" and (not origin.startswith("https://") or urlsplit(origin).path):
        raise RuntimeError("Online cần STUDIO_ORIGIN=https://ten-mien, không có đường dẫn.")
    store = Store(
        directory or os.environ.get("STUDIO_DATA_DIR", DATA_DIR),
        int(os.environ.get("STUDIO_DAILY_TASKS", "200")),
        int(os.environ.get("STUDIO_GLOBAL_TASKS", "1000")),
    )
    embedded_worker = mode == "local" if embedded_worker is None else embedded_worker
    local_csrf = secrets.token_urlsafe(24)
    stop = threading.Event()

    @asynccontextmanager
    async def lifespan(app):
        thread = None
        if embedded_worker:
            kwargs = {"client_factory": client_factory} if client_factory else {}
            thread = threading.Thread(
                target=loop,
                args=(store, stop),
                kwargs={**kwargs, "env_path": env_path},
                daemon=True,
            )
            thread.start()
        yield
        stop.set()
        if thread:
            await run_in_threadpool(thread.join, 130)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store

    @app.middleware("http")
    async def boundary(request, call_next):
        host = urlsplit("http://" + request.headers.get("host", "")).hostname
        valid_host = (
            host in {"127.0.0.1", "localhost", "testserver"}
            if mode == "local"
            else host == urlsplit(origin).hostname
        )
        if not valid_host:
            return JSONResponse({"error": "Host không được phép."}, 403)
        if request.method not in {"GET", "HEAD"}:
            expected = origin if mode == "online" else "http://" + request.headers.get("host", "")
            if request.headers.get("origin") != expected:
                return JSONResponse({"error": "Nguồn yêu cầu không hợp lệ."}, 403)
            try:
                if int(request.headers.get("content-length", "0")) > MAX_BODY:
                    return JSONResponse({"error": "Yêu cầu tối đa 25 MB."}, 413)
            except ValueError:
                return JSONResponse({"error": "Dung lượng không hợp lệ."}, 400)
            # Count streaming bodies, including chunked uploads, before multipart parser allocates files.
            chunks, total = [], 0
            async for chunk in request.stream():
                total += len(chunk)
                if total > MAX_BODY:
                    return JSONResponse({"error": "Yêu cầu tối đa 25 MB."}, 413)
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers.update(
            {
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "same-origin",
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            }
        )
        if mode == "online":
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    @app.exception_handler(ValueError)
    async def value_error(_, exc):
        return JSONResponse(
            {
                "error": str(exc)
                if not isinstance(exc, json.JSONDecodeError)
                else "JSON không hợp lệ."
            },
            400,
        )

    @app.exception_handler(KeyError)
    async def missing(_, exc):
        return JSONResponse({"error": "Không tìm thấy dữ liệu."}, 404)

    @app.exception_handler(HTTPException)
    async def http_error(_, exc):
        return JSONResponse({"error": exc.detail}, exc.status_code)

    def user(request, write=False):
        account = (
            {"id": "local", "email": "Không gian trên máy này", "role": "local", "csrf": local_csrf}
            if mode == "local"
            else store.session(request.cookies.get("studio_session", ""))
        )
        if not account:
            raise HTTPException(401, "Đăng nhập để lưu và tóm tắt tài liệu.")
        if write and not hmac.compare_digest(
            request.headers.get("x-csrf-token", ""), account["csrf"]
        ):
            raise HTTPException(403, "Phiên làm việc đã thay đổi. Tải lại trang.")
        return account

    async def body(request):
        try:
            result = await request.json()
        except Exception:
            raise ValueError("JSON không hợp lệ.") from None
        if not isinstance(result, dict):
            raise ValueError("Cần object JSON.")
        return result

    def preflight(value):
        """Bound task expansion before rendering prompts; prevent oversized fan-out allocations."""
        docs = value.get("documents")
        common = value.get("settings", {})
        if not isinstance(docs, list) or not 1 <= len(docs) <= 100 or not isinstance(common, dict):
            raise ValueError("Bản beta nhận từ 1–100 tài liệu mỗi lượt.")
        count, source_chars = 0, 0
        for doc in docs:
            if (
                not isinstance(doc, dict)
                or not isinstance(doc.get("text"), str)
                or not isinstance(doc.get("overrides", {}), dict)
            ):
                raise ValueError("Tài liệu không hợp lệ.")
            prompts = {**common, **doc.get("overrides", {})}.get("prompts")
            if not isinstance(prompts, list) or not 1 <= len(prompts) <= 10:
                raise ValueError("Mỗi tài liệu cần 1–10 prompt.")
            for prompt in prompts:
                if (
                    not isinstance(prompt, dict)
                    or not isinstance(prompt.get("text"), str)
                    or len(prompt["text"]) > 10_000
                ):
                    raise ValueError("Mỗi prompt nhận tối đa 10.000 ký tự.")
            count += len(prompts)
            source_chars += len(doc["text"])
        if count > 100 or source_chars > 1_000_000:
            raise ValueError("Bản beta nhận tối đa 100 tác vụ và 1 triệu ký tự nguồn mỗi lượt.")

    @app.get("/api/session")
    def session(request: Request):
        account = (
            {"id": "local", "email": "Không gian trên máy này", "role": "local", "csrf": local_csrf}
            if mode == "local"
            else store.session(request.cookies.get("studio_session", ""))
        )
        return {
            "mode": mode,
            "user": account,
            "usage": store.usage(account["id"]) if account else None,
            "retention_days": max(1, int(os.environ.get("STUDIO_RETENTION_DAYS", "30"))),
        }

    @app.post("/api/login")
    async def login(request: Request):
        if mode == "local":
            raise ValueError("Chế độ local không cần đăng nhập.")
        data = await body(request)
        fingerprint = hashlib.sha256(
            (request.client.host + ":" + str(data.get("email", "")).lower()).encode()
        ).hexdigest()
        store.rate_limit("login-ip:" + request.client.host, 30, 900)
        store.rate_limit("login:" + fingerprint, 8, 900)
        token, csrf = await run_in_threadpool(
            store.login, data.get("email", ""), data.get("password", "")
        )
        response = JSONResponse({"ok": True})
        response.set_cookie(
            "studio_session",
            token,
            secure=True,
            httponly=True,
            samesite="strict",
            max_age=86400,
            path="/",
        )
        return response

    @app.post("/api/logout")
    def logout(request: Request):
        user(request, True)
        store.logout(request.cookies.get("studio_session", ""))
        response = JSONResponse({"ok": True})
        response.delete_cookie("studio_session", secure=True, httponly=True, samesite="strict")
        return response

    @app.get("/api/config")
    def config():
        return {
            "providers": public_provider_configs(env_path),
            "mode": mode,
            "demo": client_factory is not None,
        }

    @app.get("/api/prompts")
    def prompts():
        return json.loads((RESOURCES_DIR / "prompt_library.json").read_text(encoding="utf-8"))

    @app.get("/api/draft")
    def get_draft(request: Request):
        return store.draft(user(request)["id"])

    @app.post("/api/draft")
    async def draft(request: Request):
        account = user(request, True)
        value = await body(request)
        documents = value.get("documents")
        if not isinstance(documents, list) or len(documents) > 1000:
            raise ValueError("Bản nháp nhận tối đa 1.000 tài liệu.")
        store.save_draft(account["id"], value)
        return {"saved": True}

    @app.get("/api/my-prompts")
    def my_prompts(request: Request):
        account = user(request)
        with store.connection() as db:
            row = db.execute("SELECT body FROM prompts WHERE owner=?", (account["id"],)).fetchone()
            return {"prompts": json.loads(row[0]) if row else []}

    @app.post("/api/my-prompts")
    async def save_prompts(request: Request):
        account = user(request, True)
        value = parse_prompts(encode((await body(request)).get("prompts")))
        if len(value) > 100:
            raise ValueError("Thư viện riêng tối đa 100 prompt.")
        with store.connection() as db:
            db.execute(
                "INSERT INTO prompts VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body",
                (account["id"], encode(value)),
            )
        return {"saved": True}

    @app.post("/api/import")
    async def upload(request: Request):
        account = user(request, True)
        store.rate_limit("import:" + account["id"], 120, 60)
        async with request.form(max_files=1, max_fields=2) as form:
            file = form.get("file")
            if not file or not hasattr(file, "read"):
                raise ValueError("Chưa chọn file.")
            content = await file.read(MAX_BODY)
            value = await run_in_threadpool(
                import_document,
                content,
                file.filename,
                form.get("kind", "data"),
                form.get("field", "document"),
            )
            return {"parsed": value}

    @app.post("/api/validate")
    async def validate(request: Request):
        user(request, True)
        value = await body(request)
        preflight(value)
        documents, tasks = normalize_payload(value, read_provider_configs(env_path))
        return {
            "documents": len(documents),
            "requests": len(tasks),
            "preview": [{"id": t["document_id"], **t["budget"]} for t in tasks],
        }

    @app.post("/api/jobs", status_code=202)
    async def submit(request: Request):
        account = user(request, True)
        store.rate_limit("jobs:" + account["id"], 20, 60)
        value = await body(request)
        preflight(value)
        documents, tasks = normalize_payload(value, read_provider_configs(env_path))
        idem = request.headers.get("idempotency-key", "")
        if not 8 <= len(idem) <= 128:
            raise ValueError("Yêu cầu cần Idempotency-Key từ 8–128 ký tự.")
        return {"id": store.submit(account["id"], value, documents, tasks, idem)}

    @app.get("/api/history")
    def history(request: Request):
        return {"jobs": store.history(user(request)["id"])}

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str, request: Request):
        return store.job(user(request)["id"], job_id)

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel(job_id: str, request: Request):
        store.cancel(user(request, True)["id"], job_id)
        return {"ok": True}

    @app.post("/api/jobs/{job_id}/delete")
    def delete(job_id: str, request: Request):
        store.delete(user(request, True)["id"], job_id)
        return {"ok": True}

    @app.get("/api/jobs/{job_id}/download")
    def download(job_id: str, request: Request):
        state = store.job(user(request)["id"], job_id)
        path = store.directory / (state["id"] + ".json")
        if not path.is_file():
            raise HTTPException(404, "Chưa có file kết quả.")
        return FileResponse(
            path, filename="summaries_" + state["id"][:8] + ".json", media_type="application/json"
        )

    @app.get("/health")
    def health():
        with store.connection() as db:
            db.execute("SELECT 1")
            row = db.execute("SELECT heartbeat FROM worker WHERE id=1").fetchone()
        return {
            "status": "ok",
            "worker_seen": bool(row),
            "worker_last_seen": row[0] if row else None,
        }

    @app.get("/")
    def index():
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/{filename}")
    def static(filename: str):
        if filename not in {
            "app.js",
            "style.css",
            "api.js",
            "state.js",
            "summora-logo.png",
            "favicon.ico",
            "favicon-32.png",
            "apple-touch-icon.png",
        }:
            raise HTTPException(404, "Không tìm thấy.")
        return FileResponse(WEB_DIR / filename)

    return app
