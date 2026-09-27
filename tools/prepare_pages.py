#!/usr/bin/env python3
"""Validate local index references and assemble the static GitHub Pages artifact."""

from __future__ import annotations

import argparse
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = {
    ".git",
    ".github",
    "docs",
    "node_modules",
    "tests",
    "tools",
    "__pycache__",
}
EXCLUDED_FILES = {
    ".gitignore",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "DESIGN.md",
    "README.md",
    "package.json",
    "package-lock.json",
    "playwright.config.js",
}


class LocalReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        for name in ("href", "src"):
            value = values.get(name)
            if value:
                self.references.append(value)


def tracked_and_untracked_site_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    paths = []
    for raw in result.stdout.split(b"\0"):
        if not raw:
            continue
        relative = Path(raw.decode("utf-8"))
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        if relative.name in EXCLUDED_FILES or relative.name.startswith(".codex"):
            continue
        source = ROOT / relative
        if source.is_file():
            paths.append(relative)
    return paths


def validate_index(output: Path) -> None:
    index = output / "index.html"
    if not index.is_file():
        raise SystemExit("Static artifact is missing index.html")
    parser = LocalReferenceParser()
    parser.feed(index.read_text(encoding="utf-8"))
    missing = []
    for reference in parser.references:
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc or reference.startswith(("#", "data:")):
            continue
        local_path = (output / parsed.path.lstrip("/")).resolve()
        if output.resolve() not in local_path.parents and local_path != output.resolve():
            missing.append(reference)
        elif not local_path.exists():
            missing.append(reference)
    if missing:
        raise SystemExit("Static artifact has missing local references: " + ", ".join(missing[:20]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="_site", help="artifact folder (default: _site)")
    args = parser.parse_args()

    output = (ROOT / args.output).resolve()
    if output.parent != ROOT or output.name != "_site":
        raise SystemExit("The build output must be the repository's _site directory")

    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    paths = tracked_and_untracked_site_files()
    for relative in paths:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)

    validate_index(output)
    total_bytes = sum((output / relative).stat().st_size for relative in paths)
    print(f"Static site artifact ready: {len(paths):,} files, {total_bytes / 1_000_000:.1f} MB at {output}")


if __name__ == "__main__":
    main()
