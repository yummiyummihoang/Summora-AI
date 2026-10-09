import os
import time
import unittest
from unittest.mock import patch

import jwt
from fastapi.testclient import TestClient
from summora.api import create_app
from summora.auth import verify_supabase_token


class SupabaseAuthTests(unittest.TestCase):
    def test_verifies_valid_hs256_token_and_rejects_wrong_issuer(self):
        base = "https://project.example"
        claims = {
            "sub": "10000000-0000-0000-0000-000000000000",
            "email": "person@example.com",
            "aud": "authenticated",
            "iss": f"{base}/auth/v1",
            "exp": int(time.time()) + 120,
        }
        secret = "test-secret-with-at-least-32-bytes-long"
        with patch.dict(os.environ, {"SUPABASE_URL": base, "SUPABASE_JWT_SECRET": secret}):
            token = jwt.encode(claims, secret, algorithm="HS256")
            self.assertEqual(verify_supabase_token(token)["email"], "person@example.com")
            invalid = jwt.encode(
                {**claims, "iss": "https://other.example/auth/v1"}, secret, algorithm="HS256"
            )
            with self.assertRaises(ValueError):
                verify_supabase_token(invalid)

    def test_protected_api_routes_require_supabase_token(self):
        env = {
            "DATABASE_URL": "postgresql://user:password@127.0.0.1:5432/summora",
            "SUPABASE_URL": "https://project.example",
            "SUPABASE_JWT_SECRET": "test-secret",
        }
        with patch.dict(os.environ, env):
            app = create_app(embedded_worker=False)
            with TestClient(app) as client:
                self.assertEqual(client.get("/api/prompts").status_code, 200)
                self.assertIsNone(client.get("/api/session").json()["user"])
                self.assertEqual(client.get("/api/draft").status_code, 401)
                self.assertEqual(client.post("/api/jobs", json={}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
