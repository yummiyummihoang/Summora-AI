"""Private Supabase Storage for result files shared by stateless deployments."""

import os
from pathlib import Path
from urllib.parse import quote

import httpx


def _config():
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    bucket = os.environ.get("STUDIO_RESULTS_BUCKET", "summora-results")
    if not base or not key:
        if os.environ.get("VERCEL"):
            raise RuntimeError(
                "Vercel cần SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY để lưu kết quả."
            )
        return None
    return base, key, bucket


def _headers(key):
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _object_url(base, bucket, job_id):
    return f"{base}/storage/v1/object/{quote(bucket, safe='')}/{quote(job_id + '.json', safe='')}"


def upload_result(job_id: str, path: Path) -> bool:
    config = _config()
    if not config:
        return False
    base, key, bucket = config
    with path.open("rb") as result:
        response = httpx.post(
            _object_url(base, bucket, job_id),
            headers={**_headers(key), "Content-Type": "application/json", "x-upsert": "true"},
            content=result,
            timeout=60,
        )
    response.raise_for_status()
    return True


def create_download_url(job_id: str) -> str | None:
    config = _config()
    if not config:
        return None
    base, key, bucket = config
    response = httpx.post(
        f"{base}/storage/v1/object/sign/{quote(bucket, safe='')}/{quote(job_id + '.json', safe='')}",
        headers={**_headers(key), "Content-Type": "application/json"},
        json={"expiresIn": 300, "download": f"summaries_{job_id[:8]}.json"},
        timeout=15,
    )
    response.raise_for_status()
    signed = response.json().get("signedURL")
    if not isinstance(signed, str) or not signed:
        raise RuntimeError("Supabase Storage did not return a signed download URL")
    if signed.startswith("/storage/v1/"):
        return base + signed
    if signed.startswith("/"):
        return base + "/storage/v1" + signed
    return signed


def delete_result(job_id: str) -> bool:
    config = _config()
    if not config:
        return False
    base, key, bucket = config
    response = httpx.delete(
        f"{base}/storage/v1/object/{quote(bucket, safe='')}",
        headers={**_headers(key), "Content-Type": "application/json"},
        json={"prefixes": [job_id + ".json"]},
        timeout=15,
    )
    response.raise_for_status()
    return True
