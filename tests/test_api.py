"""Regression checks for the active API, replacing the retired HTTP server."""

import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from summora.api import create_app
from summora.worker import process
from tests.helpers import FakeClient, payload, settings


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = self.root / "config.env"
        self.env.write_text(
            "OPENAI_API_KEY=test-only\nOPENAI_MODELS=model-a\nDEEPSEEK_API_KEY=test-only\nDEEPSEEK_MODELS=model-b\n",
            encoding="utf-8",
        )
        self.app = create_app(self.root / "data", embedded_worker=False, env_path=self.env)
        self.client = TestClient(self.app)
        self.headers = {
            "Origin": "http://testserver",
            "X-CSRF-Token": self.client.get("/api/session").json()["user"]["csrf"],
        }

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def submit(self, value=None, key="api-test-request"):
        return self.client.post(
            "/api/jobs", json=value or payload(), headers={**self.headers, "Idempotency-Key": key}
        )

    def test_multiple_providers_snapshot_export_and_client_cleanup(self):
        self.assertEqual(self.client.get("/api/prompts").status_code, 200)
        value = payload()
        value["documents"][1]["overrides"] = settings("deepseek", "model-b")
        response = self.submit(value)
        self.assertEqual(response.status_code, 202, response.text)
        clients = []

        def factory(*_):
            client = FakeClient()
            clients.append(client)
            return client

        process(self.app.state.store, self.app.state.store.claim(), factory, self.env)
        job_id = response.json()["id"]
        state = self.client.get(f"/api/jobs/{job_id}").json()
        self.assertEqual(state["success"], 2)
        self.assertEqual([r["document_id"] for r in state["results"]], ["first", "second"])
        self.assertTrue(all(r["length_ok"] for r in state["results"]))
        self.assertTrue(all(c.closed for c in clients))
        exported = self.client.get(f"/api/jobs/{job_id}/download").json()
        self.assertEqual(exported["data"][0]["generated_summaries"][0]["actual_words"], 20)
        self.assertNotIn("test-only", json.dumps(exported))

    def test_model_validation_and_secret_redaction(self):
        self.assertNotIn("test-only", self.client.get("/api/config").text)
        bad = payload()
        bad["settings"]["model"] = "unconfigured"
        self.assertEqual(
            self.client.post("/api/validate", json=bad, headers=self.headers).status_code, 400
        )
        self.assertEqual(
            self.client.post("/api/jobs", json={"documents": []}, headers=self.headers).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                "/api/validate",
                json=payload(),
                headers={**self.headers, "Origin": "https://foreign.example"},
            ).status_code,
            403,
        )

    def test_cancel_and_single_active_job(self):
        response = self.submit()
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.submit(key="another-request-key").status_code, 400)
        job_id = response.json()["id"]
        self.assertEqual(
            self.client.post(
                f"/api/jobs/{job_id}/cancel", json={}, headers=self.headers
            ).status_code,
            200,
        )
        state = self.client.get(f"/api/jobs/{job_id}").json()
        self.assertEqual(state["status"], "cancelled")
        self.assertIsNone(self.app.state.store.claim())
