"""FastAPI for document import and durable AI summarization jobs."""

import json
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from summora.auth import verify_supabase_token
from summora.config import ENV_PATH, public_provider_configs, read_provider_configs
from summora.documents import import_document
from summora.formats import parse_prompts
from summora.paths import DATA_DIR, RESOURCES_DIR
from summora.storage import Store, encode
from summora.tasks import normalize_payload
from summora.worker import loop

MAX_BODY = 25 * 1024 * 1024


def create_app(
    directory=None, mode=None, embedded_worker=None, env_path=ENV_PATH, client_factory=None
):
    mode = mode or os.environ.get("STUDIO_MODE", "online")
    if mode != "online":
        raise RuntimeError("Summora cần Supabase Auth và PostgreSQL.")
    store = Store(
        directory or os.environ.get("STUDIO_DATA_DIR", DATA_DIR),
        int(os.environ.get("STUDIO_DAILY_TASKS", "200")),
        int(os.environ.get("STUDIO_GLOBAL_TASKS", "1000")),
    )
    embedded_worker = False if embedded_worker is None else embedded_worker
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
    allowed_origins = [
        value.strip().rstrip("/")
        for value in os.environ.get("WEB_ORIGIN", "http://localhost:3000").split(",")
        if value.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @app.middleware("http")
    async def security_headers(request, call_next):
        try:
            if int(request.headers.get("content-length", "0")) > MAX_BODY:
                return JSONResponse({"error": "Yêu cầu tối đa 25 MB."}, 413)
        except ValueError:
            return JSONResponse({"error": "Dung lượng không hợp lệ."}, 400)
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
                "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            }
        )
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
        authorization = request.headers.get("authorization", "")
        if not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "Đăng nhập để lưu và tóm tắt tài liệu.")
        try:
            claims = verify_supabase_token(authorization[7:].strip())
        except Exception:
            raise HTTPException(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.") from None
        if not claims.get("sub") or not claims.get("email"):
            raise HTTPException(401, "Phiên đăng nhập không hợp lệ.")
        return {"id": claims["sub"], "email": claims["email"], "role": "member"}

    async def body(request):
        try:
            value = await request.json()
        except Exception:
            raise ValueError("JSON không hợp lệ.") from None
        if not isinstance(value, dict):
            raise ValueError("Cần object JSON.")
        return value

    def preflight(value):
        docs, common = value.get("documents"), value.get("settings", {})
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
        try:
            account = user(request)
        except HTTPException:
            return {
                "mode": "online",
                "user": None,
                "usage": None,
                "retention_days": max(1, int(os.environ.get("STUDIO_RETENTION_DAYS", "30"))),
            }
        return {
            "mode": "online",
            "user": account,
            "usage": store.usage(account["id"]),
            "retention_days": max(1, int(os.environ.get("STUDIO_RETENTION_DAYS", "30"))),
        }

    @app.get("/api/config")
    def config():
        return {
            "providers": public_provider_configs(env_path),
            "mode": "online",
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
        account = user(request)
        value = await body(request)
        docs = value.get("documents")
        if not isinstance(docs, list) or len(docs) > 1000:
            raise ValueError("Bản nháp nhận tối đa 1.000 tài liệu.")
        store.save_draft(account["id"], value)
        return {"saved": True}

    @app.get("/api/my-prompts")
    def my_prompts(request: Request):
        return {"prompts": store.prompts(user(request)["id"])}

    @app.post("/api/my-prompts")
    async def save_prompts(request: Request):
        account = user(request)
        value = parse_prompts(encode((await body(request)).get("prompts")))
        if len(value) > 100:
            raise ValueError("Thư viện riêng tối đa 100 prompt.")
        store.save_prompts(account["id"], value)
        return {"saved": True}

    @app.post("/api/import")
    async def upload(request: Request):
        account = user(request)
        store.rate_limit("import:" + account["id"], 120, 60)
        async with request.form(max_files=1, max_fields=2) as form:
            file = form.get("file")
            if not file or not hasattr(file, "read"):
                raise ValueError("Chưa chọn file.")
            content = await file.read(MAX_BODY)
            parsed = await run_in_threadpool(
                import_document,
                content,
                file.filename,
                form.get("kind", "data"),
                form.get("field", "document"),
            )
            return {"parsed": parsed}

    @app.post("/api/validate")
    async def validate(request: Request):
        user(request)
        value = await body(request)
        preflight(value)
        documents, tasks = normalize_payload(value, read_provider_configs(env_path))
        return {
            "documents": len(documents),
            "requests": len(tasks),
            "preview": [{"id": task["document_id"], **task["budget"]} for task in tasks],
        }

    @app.post("/api/jobs", status_code=202)
    async def submit(request: Request):
        account = user(request)
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
        store.cancel(user(request)["id"], job_id)
        return {"ok": True}

    @app.post("/api/jobs/{job_id}/delete")
    def delete(job_id: str, request: Request):
        store.delete(user(request)["id"], job_id)
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
        try:
            heartbeat = store.health()
        except Exception:
            raise HTTPException(503, "Không kết nối được Supabase PostgreSQL.") from None
        return {"status": "ok", "worker_seen": bool(heartbeat), "worker_last_seen": heartbeat}

    return app
