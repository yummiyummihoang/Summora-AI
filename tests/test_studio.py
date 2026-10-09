"""Account ownership, durable queue, CSRF, quota and recovery checks without paid API calls."""

import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from summora.api import create_app
from summora.cli.backup import backup, restore
from summora.storage import Store
from summora.tasks import normalize_payload
from summora.worker import loop, process
from tests.helpers import FakeClient, payload


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = self.root / "config.env"
        self.env.write_text("OPENAI_API_KEY=fake-key\nOPENAI_MODELS=model-a\n", encoding="utf-8")
        self.app = create_app(self.root / "data", embedded_worker=False, env_path=self.env)
        self.store = self.app.state.store
        self.client = TestClient(self.app)
        self.csrf = self.client.get("/api/session").json()["user"]["csrf"]
        self.headers = {"Origin": "http://testserver", "X-CSRF-Token": self.csrf}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def submit(self, data=None, idem="request-key-123"):
        return self.client.post(
            "/api/jobs", json=data or payload(), headers={**self.headers, "Idempotency-Key": idem}
        )

    def test_csrf_upload_draft_and_private_static(self):
        self.assertEqual(self.client.post("/api/draft", json={"documents": []}).status_code, 403)
        self.assertEqual(
            self.client.post(
                "/api/draft", json={"documents": []}, headers={"Origin": "http://testserver"}
            ).status_code,
            403,
        )
        draft = {"version": 2, "documents": payload()["documents"]}
        self.assertEqual(
            self.client.post("/api/draft", json=draft, headers=self.headers).status_code, 200
        )
        self.assertEqual(self.client.get("/api/draft").json()["draft"], draft)
        upload = self.client.post(
            "/api/import",
            files={"file": ("note.txt", "Nội dung cần tóm tắt".encode())},
            data={"kind": "data", "field": "document"},
            headers=self.headers,
        )
        self.assertEqual(upload.status_code, 200, upload.text)
        self.assertEqual(upload.json()["parsed"][0]["text"], "Nội dung cần tóm tắt")
        self.assertEqual(self.client.get("/studio.sqlite3").status_code, 404)
        self.assertEqual(self.client.get("/.env").status_code, 404)
        self.assertEqual(self.client.get("/api.js").status_code, 200)
        self.assertEqual(self.client.get("/", headers={"Host": "evil.example"}).status_code, 403)

    def test_durable_idempotent_job_and_export(self):
        first = self.submit()
        self.assertEqual(first.status_code, 202, first.text)
        job_id = first.json()["id"]
        self.assertEqual(self.submit().json()["id"], job_id)
        different = payload()
        different["documents"][0]["text"] += " changed"
        self.assertEqual(self.submit(different).status_code, 400)
        self.assertEqual(self.submit(idem="new-request-key").status_code, 400)
        job = self.store.claim()
        process(self.store, job, lambda *_: FakeClient(), self.env)
        state = self.client.get(f"/api/jobs/{job_id}").json()
        self.assertEqual((state["status"], state["done"]), ("completed", 2))
        download = self.client.get(f"/api/jobs/{job_id}/download")
        self.assertEqual(download.status_code, 200)
        self.assertEqual(len(download.json()["data"]), 2)
        # Reopen application: no reliance on old process memory.
        reopened = TestClient(
            create_app(self.root / "data", embedded_worker=False, env_path=self.env)
        )
        self.assertEqual(reopened.get(f"/api/jobs/{job_id}").json()["results"], state["results"])
        reopened.close()
        self.assertEqual(self.store.usage("local")["used"], 2)
        self.assertEqual(
            self.client.post(
                f"/api/jobs/{job_id}/delete", json={}, headers=self.headers
            ).status_code,
            200,
        )
        self.assertEqual(self.client.get(f"/api/jobs/{job_id}").status_code, 404)
        self.assertEqual(self.store.usage("local")["used"], 2)
        with self.store.connection() as db:
            row = db.execute("SELECT body,state FROM jobs WHERE id=?", (job_id,)).fetchone()
            self.assertEqual(tuple(row), ("{}", "{}"))

    def test_quota_cancel_unknown_recovery(self):
        self.store.quota = 2
        first = self.submit().json()["id"]
        self.assertEqual(self.store.usage("local")["remaining"], 0)
        self.store.cancel("local", first)
        self.assertEqual(self.store.usage("local")["used"], 0)
        second = self.submit(idem="second-request-key").json()["id"]
        state = self.store.claim()
        state["tasks"][0]["status"] = "running"
        self.store.update(state, charge=True)
        self.store.recover()
        recovered = self.store.job("local", second)
        self.assertEqual(recovered["status"], "interrupted")
        self.assertEqual(recovered["tasks"][0]["status"], "unknown")
        self.assertEqual(self.store.usage("local")["used"], 1)
        self.assertIsNone(self.store.claim())
        self.assertEqual(self.submit(idem="third-request-key").status_code, 400)

    def test_concurrent_submissions_reserve_once(self):
        docs, tasks = normalize_payload(payload())
        ids, errors = [], []

        def submit():
            try:
                ids.append(
                    self.store.submit("local", payload(), docs, tasks, "same-concurrent-key")
                )
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=submit) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertFalse(errors)
        self.assertEqual(len(set(ids)), 1)
        self.assertEqual(self.store.usage("local")["used"], 2)

    def test_partial_override_multiple_prompts(self):
        data = payload()
        data["documents"][0]["overrides"] = {
            "length": {"mode": "words", "value": 15},
            "prompts": [
                {"name": "A", "text": "A {document}"},
                {"name": "B", "text": "B {document}"},
            ],
        }
        response = self.client.post("/api/validate", json=data, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["requests"], 3)
        self.assertEqual(response.json()["preview"][0]["target_words"], 15)

    def test_online_sessions_and_ownership(self):
        with patch.dict(os.environ, {"STUDIO_ORIGIN": "https://studio.example"}):
            app = create_app(
                self.root / "online", mode="online", embedded_worker=False, env_path=self.env
            )
        store = app.state.store
        store.add_user("a@example.com", "long-test-password-123")
        store.add_user("b@example.com", "long-test-password-456")
        clients = [TestClient(app, base_url="https://studio.example") for _ in range(2)]
        a, b = clients
        self.assertEqual(a.get("/api/history").status_code, 401)
        for c, email, password in [
            (a, "a@example.com", "long-test-password-123"),
            (b, "b@example.com", "long-test-password-456"),
        ]:
            login = c.post(
                "/api/login",
                json={"email": email, "password": password},
                headers={"Origin": "https://studio.example"},
            )
            self.assertEqual(login.status_code, 200, login.text)
            self.assertIn("HttpOnly", login.headers["set-cookie"])
            self.assertIn("Secure", login.headers["set-cookie"])
        ah = {
            "Origin": "https://studio.example",
            "X-CSRF-Token": a.get("/api/session").json()["user"]["csrf"],
        }
        bh = {
            "Origin": "https://studio.example",
            "X-CSRF-Token": b.get("/api/session").json()["user"]["csrf"],
        }
        job_id = a.post(
            "/api/jobs", json=payload(), headers={**ah, "Idempotency-Key": "online-test-key"}
        ).json()["id"]
        self.assertEqual(b.get(f"/api/jobs/{job_id}").status_code, 404)
        for action in ["cancel", "delete"]:
            self.assertEqual(
                b.post(f"/api/jobs/{job_id}/{action}", json={}, headers=bh).status_code, 404
            )
        self.assertEqual(b.get(f"/api/jobs/{job_id}/download").status_code, 404)
        self.assertEqual(b.get("/api/history").json()["jobs"], [])
        self.assertEqual(a.post("/api/draft", json={"documents": []}, headers=ah).status_code, 200)
        self.assertIsNone(b.get("/api/draft").json()["draft"])
        self.assertEqual(a.post("/api/logout", json={}, headers=ah).status_code, 200)
        self.assertEqual(a.get(f"/api/jobs/{job_id}").status_code, 401)
        for c in clients:
            c.close()

    def test_backup_restore_preserves_results_but_never_replays_queue(self):
        first = self.submit().json()["id"]
        process(self.store, self.store.claim(), lambda *_: FakeClient(), self.env)
        second = self.submit(idem="queued-in-backup-key").json()["id"]
        archive = backup(self.root / "data", self.root / "backup.zip")
        restore(archive, self.root / "restored")
        restored = Store(self.root / "restored")
        self.assertEqual(restored.job("local", first)["status"], "completed")
        self.assertEqual(restored.job("local", second)["status"], "cancelled")
        self.assertTrue((self.root / "restored" / (first + ".json")).is_file())
        self.assertIsNone(restored.claim())
        with self.assertRaises(RuntimeError):
            restore(archive, self.root / "restored")

    def test_body_and_prompt_expansion_limits(self):
        huge = payload()
        huge["settings"]["prompts"][0]["text"] = "x" * 10_001
        self.assertEqual(self.submit(huge).status_code, 400)
        response = self.client.post(
            "/api/draft",
            content="{}",
            headers={
                **self.headers,
                "Content-Length": str(26 * 1024 * 1024),
                "Content-Type": "application/json",
            },
        )
        self.assertEqual(response.status_code, 413)

    def test_worker_cancel_preserves_finished_result_and_releases_unstarted_tasks(self):
        job_id = self.submit().json()["id"]
        state = self.store.claim()
        store = self.store

        class CancelClient(FakeClient):
            def create(self, **kwargs):
                result = super().create(**kwargs)
                store.cancel("local", job_id)
                return result

        process(store, state, lambda *_: CancelClient(), self.env)
        final = store.job("local", job_id)
        self.assertEqual((final["status"], final["done"]), ("cancelled", 1))
        self.assertEqual(len(final["results"]), 1)
        self.assertEqual(store.usage("local")["used"], 1)
        self.assertEqual(final["tasks"][1]["status"], "cancelled")

    def test_exclusive_worker_and_recovery_of_file_written_before_database(self):
        stop = threading.Event()
        thread = threading.Thread(
            target=loop, args=(self.store, stop), kwargs={"env_path": self.env}
        )
        thread.start()
        try:
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                with self.store.connection() as db:
                    if db.execute("SELECT 1 FROM worker").fetchone():
                        break
                time.sleep(0.02)
            with self.assertRaises(RuntimeError):
                loop(self.store, threading.Event(), env_path=self.env)
        finally:
            stop.set()
            thread.join(3)
        job_id = self.submit().json()["id"]
        state = self.store.claim()
        task = state["tasks"][0]
        task["status"] = "running"
        self.store.update(state, charge=True)
        entry = {
            "task_id": task["id"],
            "document_id": task["document_id"],
            "status": "success",
            "summary": "Kết quả đã lưu",
        }
        (self.store.directory / (job_id + ".json")).write_text(
            json.dumps(
                {"data": [{"title": "Nguồn", "generated_summaries": [entry]}]}, ensure_ascii=False
            ),
            encoding="utf-8",
        )
        self.store.recover()
        recovered = self.store.job("local", job_id)
        self.assertEqual(recovered["done"], 1)
        self.assertEqual(recovered["tasks"][0]["status"], "success")
        self.assertEqual(recovered["results"][0]["summary"], "Kết quả đã lưu")


if __name__ == "__main__":
    unittest.main()
