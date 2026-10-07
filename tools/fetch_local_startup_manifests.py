#!/usr/bin/env python3
"""Fetch local development copies of R2-hosted startup data files."""

from __future__ import annotations

import argparse
import hashlib
import shutil
from pathlib import Path

if __package__:
    from .prepare_pages import ROOT, R2_STARTUP_DATA_ASSETS
    from .r2_source_data import resolve_r2_source_file
else:
    from prepare_pages import ROOT, R2_STARTUP_DATA_ASSETS
    from r2_source_data import resolve_r2_source_file


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(*, force: bool = False) -> list[str]:
    results = []
    for relative in R2_STARTUP_DATA_ASSETS:
        source_path = f"data/{relative.name}"
        cached = resolve_r2_source_file(source_path)
        target = ROOT / relative
        if target.is_file():
            if sha256_file(target) == sha256_file(cached):
                results.append(f"already current: {relative.as_posix()}")
                continue
            if not force:
                raise RuntimeError(
                    f"Local file differs from R2: {relative.as_posix()}; "
                    "review it first or rerun with --force to replace it."
                )

        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".tmp")
        shutil.copyfile(cached, temporary)
        temporary.replace(target)
        results.append(f"fetched: {relative.as_posix()}")
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="replace local manifest files that differ from the configured R2 release",
    )
    args = parser.parse_args()
    for result in fetch(force=args.force):
        print(result)


if __name__ == "__main__":
    main()
