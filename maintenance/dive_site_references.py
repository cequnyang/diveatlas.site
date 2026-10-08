"""Normalize and deduplicate per-site evidence references."""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit
from typing import Any


def reference_key(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parsed = urlsplit(text)
        if parsed.scheme.lower() in {"http", "https"} and parsed.hostname:
            host = parsed.hostname.lower()
            if parsed.port and not (
                (parsed.scheme.lower() == "http" and parsed.port == 80)
                or (parsed.scheme.lower() == "https" and parsed.port == 443)
            ):
                host = f"{host}:{parsed.port}"
            path = parsed.path.rstrip("/") or "/"
            return urlunsplit((parsed.scheme.lower(), host, path, parsed.query, parsed.fragment))
    except ValueError:
        pass
    return text.casefold()


def dedupe_reference_values(values: list[Any]) -> tuple[list[str], int]:
    """Keep the first spelling of each per-site URL or record ID."""
    output: list[str] = []
    seen: set[str] = set()
    duplicates = 0
    for value in values:
        text = str(value or "").strip()
        key = reference_key(text)
        if not key:
            continue
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        output.append(text)
    return output, duplicates


def dedupe_reference_string(value: Any) -> tuple[str, int]:
    values, duplicates = dedupe_reference_values(str(value or "").split(";"))
    return "; ".join(values), duplicates
