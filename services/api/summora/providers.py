"""Provider metadata and OpenAI-compatible client creation."""

import os

PROVIDERS = {
    "openai": {"label": "OpenAI", "base_url": "https://api.openai.com/v1", "env": "OPENAI_API_KEY"},
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "env": "OPENROUTER_API_KEY",
    },
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "env": "DEEPSEEK_API_KEY",
    },
    "gemini": {
        "label": "Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "env": "GEMINI_API_KEY",
    },
}


def make_client(provider, api_key=""):
    if provider not in PROVIDERS:
        raise ValueError("Nhà cung cấp không hợp lệ.")
    key = api_key.strip() or os.getenv(PROVIDERS[provider]["env"], "").strip()
    if not key:
        raise ValueError(f"Nhập API key hoặc đặt biến môi trường {PROVIDERS[provider]['env']}.")
    from openai import OpenAI

    return OpenAI(
        api_key=key, base_url=PROVIDERS[provider]["base_url"], timeout=120.0, max_retries=0
    )
