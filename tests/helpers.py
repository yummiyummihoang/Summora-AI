"""Shared fake providers and document fixtures; never call paid APIs."""

import re
import time
from types import SimpleNamespace


def settings(provider="openai", model="model-a", prompts=None):
    return {
        "provider": provider,
        "model": model,
        "prompts": prompts or [{"name": "Cơ bản", "text": "Tóm tắt: {document}"}],
        "length": {"mode": "percent", "value": 20},
        "parameters": {"N": 1},
        "output_format": "paragraph",
    }


def payload():
    return {
        "settings": settings(),
        "documents": [
            {
                "id": "first",
                "title": "Văn bản kiểm thử A",
                "text": " ".join(["nguồn"] * 100),
                "revision": 1,
            },
            {
                "id": "second",
                "title": "Văn bản kiểm thử B",
                "text": " ".join(["nguồn"] * 50),
                "revision": 1,
            },
        ],
    }


class FakeClient:
    def __init__(self, fail=None, gate=None):
        self.chat = SimpleNamespace(completions=self)
        self.calls, self.closed, self.fail, self.gate = [], False, fail, gate

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.gate:
            self.gate.wait(timeout=5)
        if self.fail:
            exc = RuntimeError("must not expose fake secret")
            exc.status_code = self.fail
            raise exc
        match = re.search(r"mục tiêu (\d+) từ", kwargs["messages"][0]["content"])
        count = int(match.group(1)) if match else 20
        summary = " ".join(["Kiểm thử"] * (count // 2)) + (" mẫu" if count % 2 else "")
        return SimpleNamespace(
            choices=[
                SimpleNamespace(message=SimpleNamespace(content=summary), finish_reason="stop")
            ],
            usage=None,
        )

    def close(self):
        self.closed = True


class PreviewClient(FakeClient):
    def __init__(self, delay=0.1):
        super().__init__()
        self.delay = delay

    def create(self, **kwargs):
        time.sleep(self.delay)
        if "FAIL_TEST" in kwargs["messages"][1]["content"]:
            error = RuntimeError("Test failure")
            error.status_code = 500
            raise error
        return super().create(**kwargs)
