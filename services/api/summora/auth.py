"""Verify Supabase Auth access tokens in the Python API."""

import os
from functools import lru_cache

import jwt
from jwt import PyJWKClient


@lru_cache(maxsize=1)
def _jwks_client():
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("Cần cấu hình SUPABASE_URL.")
    return PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_keys=True)


def verify_supabase_token(token):
    header = jwt.get_unverified_header(token)
    algorithm = header.get("alg")
    if algorithm == "HS256":
        secret = os.environ.get("SUPABASE_JWT_SECRET")
        if not secret:
            raise ValueError("Thiếu SUPABASE_JWT_SECRET cho JWT HS256.")
        key = secret
    elif algorithm in {"ES256", "RS256"}:
        key = _jwks_client().get_signing_key_from_jwt(token).key
    else:
        raise ValueError("Thuật toán JWT không được hỗ trợ.")
    claims = jwt.decode(
        token,
        key,
        algorithms=[algorithm],
        audience="authenticated",
        options={"require": ["exp", "sub", "aud"]},
    )
    issuer = os.environ.get("SUPABASE_URL", "").rstrip("/") + "/auth/v1"
    if claims.get("iss") != issuer:
        raise ValueError("JWT không thuộc Supabase project đã cấu hình.")
    return claims
