#!/usr/bin/env python3
"""Build store-ready Chrome and Firefox extension packages."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"

COMMON_FILES = [
    "content.js",
    "popup.css",
    "popup.html",
    "popup.js",
    "service-worker.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
]

TARGETS = {
    "chrome": {
        "manifest": "manifest.json",
        "extra": ["offscreen.html", "offscreen.js"],
    },
    "firefox": {
        "manifest": "manifest.firefox.json",
        "extra": ["offscreen.js"],
    },
}


def load_manifest(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_manifests() -> str:
    chrome = load_manifest(ROOT / "manifest.json")
    firefox = load_manifest(ROOT / "manifest.firefox.json")

    if chrome.get("manifest_version") != 3 or firefox.get("manifest_version") != 3:
        raise ValueError("Both store manifests must use Manifest V3.")

    if chrome.get("version") != firefox.get("version"):
        raise ValueError("Chrome and Firefox manifest versions must match.")

    if "offscreen" not in chrome.get("permissions", []):
        raise ValueError("Chrome manifest must retain the offscreen permission.")

    if "offscreen" in firefox.get("permissions", []):
        raise ValueError("Firefox manifest must not request the Chrome-only offscreen permission.")

    firefox_scripts = firefox.get("background", {}).get("scripts", [])
    if firefox_scripts != ["offscreen.js", "service-worker.js"]:
        raise ValueError(
            "Firefox background scripts must load offscreen.js before service-worker.js."
        )

    gecko = firefox.get("browser_specific_settings", {}).get("gecko", {})
    if not gecko.get("id"):
        raise ValueError("Firefox Manifest V3 package requires browser_specific_settings.gecko.id.")

    required_data = gecko.get("data_collection_permissions", {}).get("required")
    if required_data != ["none"]:
        raise ValueError(
            'Firefox local-only package must declare data_collection_permissions.required=["none"].'
        )

    return chrome["version"]


def copy_file(source_rel: str, destination_root: Path) -> None:
    source = ROOT / source_rel
    if not source.is_file():
        raise FileNotFoundError(f"Missing package file: {source_rel}")
    destination = destination_root / source_rel
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def build_target(target: str, version: str) -> tuple[Path, Path]:
    config = TARGETS[target]
    unpacked = DIST / target

    if unpacked.exists():
        shutil.rmtree(unpacked)
    unpacked.mkdir(parents=True)

    for source_rel in COMMON_FILES + config["extra"]:
        copy_file(source_rel, unpacked)

    manifest_source = ROOT / config["manifest"]
    shutil.copy2(manifest_source, unpacked / "manifest.json")

    archive = DIST / f"capture-full-page-{target}-{version}.zip"
    if archive.exists():
        archive.unlink()

    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(unpacked.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(unpacked).as_posix())

    return unpacked, archive


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--target",
        choices=["all", *TARGETS.keys()],
        default="all",
        help="Package one browser or both (default: all).",
    )
    args = parser.parse_args()

    version = validate_manifests()
    DIST.mkdir(exist_ok=True)

    targets = TARGETS.keys() if args.target == "all" else [args.target]
    for target in targets:
        unpacked, archive = build_target(target, version)
        print(f"{target}: {unpacked.relative_to(ROOT)}")
        print(f"{target}: {archive.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"build failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
