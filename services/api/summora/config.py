"""Đọc .env mới nhất; chỉ trả trạng thái key và tên model cho UI."""

import os
from pathlib import Path

from dotenv import dotenv_values

from summora.paths import ENV_PATH
from summora.providers import PROVIDERS


def read_provider_configs(path=ENV_PATH):
    values = dotenv_values(Path(path), encoding="utf-8-sig", interpolate=False)
    values.update(
        {key: value for key, value in os.environ.items() if key.endswith(("_API_KEY", "_MODELS"))}
    )
    configs = {}
    for provider, info in PROVIDERS.items():
        prefix = provider.upper()
        key = (values.get(info["env"]) or "").strip()
        models = list(
            dict.fromkeys(
                name.strip()
                for name in (values.get(f"{prefix}_MODELS") or "").split(",")
                if name.strip()
            )
        )
        configs[provider] = {"api_key": key, "models": models}
    return configs


def public_provider_configs(path=ENV_PATH):
    configs = read_provider_configs(path)
    return {
        provider: {
            "label": PROVIDERS[provider]["label"],
            "key_configured": bool(config["api_key"]),
            "models": config["models"],
            "ready": bool(config["api_key"] and config["models"]),
        }
        for provider, config in configs.items()
    }
