"""Durable queue consumer. Deploy exactly one worker; API processes never execute jobs."""

import os
import threading

from summora.config import read_provider_configs
from summora.paths import DATA_DIR, ENV_PATH
from summora.providers import make_client
from summora.storage import Store
from summora.tasks import run_tasks


def process(store, state, client_factory=make_client, env_path=ENV_PATH, stop=None):
    clients = {}
    path = store.directory / (state["id"] + ".json")
    documents, tasks = state["documents"], state["tasks"]

    def started(task):
        task["status"] = "running"
        state["message"] = f"{documents[task['row'] - 1]['title']} · {task['prompt_name']}"
        # Charge before network I/O: interrupted requests may already have incurred provider cost.
        store.update(state, charge=True)

    def progress(task, entry):
        task["status"] = entry["status"]
        state["done"] += 1
        state["success" if entry["status"] == "success" else "errors"] += 1
        state["results"].append({"title": documents[task["row"] - 1]["title"], **entry})
        state["download_ready"] = True
        store.update(state)

    try:
        configs = read_provider_configs(env_path)
        for provider in {t["provider"] for t in tasks}:
            clients[provider] = client_factory(provider, configs[provider]["api_key"])
        result = run_tasks(
            documents,
            tasks,
            clients,
            path,
            progress,
            lambda: store.stopped(state["id"]) or bool(stop and stop.is_set()),
            started,
        )
        state["status"] = result["run"]["status"]
        state["message"] = (
            "Đã hoàn thành."
            if state["status"] == "completed"
            else "Lượt chạy kết thúc; kiểm tra trạng thái từng kết quả."
        )
    except Exception:
        state.update(
            status="failed", message="Không thể hoàn tất. Kiểm tra cấu hình và kết nối API."
        )
    finally:
        for client in clients.values():
            try:
                client.close()
            except Exception:
                pass
        state["download_ready"] = path.is_file()
        for task in tasks:
            if task["status"] in {"waiting", "running"}:
                task["status"] = "cancelled" if state["status"] == "cancelled" else "error"
        store.update(state, final=True)


def loop(store, stop, client_factory=make_client, env_path=ENV_PATH):
    # A SQLite lease prevents accidental second workers and unsafe recovery of a live request.
    import sqlite3
    import time

    lease = sqlite3.connect(store.directory / "worker-lock.sqlite3", timeout=0)
    try:
        lease.execute("CREATE TABLE IF NOT EXISTS singleton(id INTEGER)")
        lease.commit()
        lease.execute("BEGIN EXCLUSIVE")
    except sqlite3.OperationalError:
        lease.close()
        raise RuntimeError("Một worker khác đang chạy; chỉ khởi động một worker.") from None
    try:
        store.recover()
        last_prune = 0
        while not stop.is_set():
            if time.time() - last_prune > 3600:
                store.prune(max(1, int(os.environ.get("STUDIO_RETENTION_DAYS", "30"))))
                last_prune = time.time()
            state = store.claim()
            if state:
                process(store, state, client_factory, env_path, stop)
            else:
                stop.wait(0.5)
    finally:
        lease.rollback()
        lease.close()


if __name__ == "__main__":
    import signal

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    store = Store(
        os.environ.get("STUDIO_DATA_DIR", DATA_DIR),
        int(os.environ.get("STUDIO_DAILY_TASKS", "200")),
        int(os.environ.get("STUDIO_GLOBAL_TASKS", "1000")),
    )
    try:
        loop(store, stop)
    except KeyboardInterrupt:
        pass
