#!/usr/bin/env python3
"""Offline publication checks. Reports locations/rules, never secret values."""
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def main():
    errors = []
    package = json.loads((ROOT / "package.json").read_text())
    config = (ROOT / "mygo.config.ts").read_text()
    configured = re.search(r'\bversion:\s*"([^"]+)"', config)
    if not configured or configured[1] != package["version"]:
        errors.append("package.json and mygo.config.ts versions differ")
    if len(sys.argv) > 1 and sys.argv[1] != "v" + package["version"]:
        errors.append("release tag must equal v + package.json version")
    if package.get("license") != "MIT" or not (ROOT / "LICENSE").is_file():
        errors.append("MIT package metadata/license is missing")
    if package.get("packageManager") != "bun@" + (ROOT / ".bun-version").read_text().strip():
        errors.append("packageManager must match .bun-version")

    output = subprocess.check_output([
        "git", "ls-files", "--cached", "--others", "--exclude-standard", "-z",
    ], cwd=ROOT)
    files = {Path(p.decode()) for p in output.split(b"\0") if p}
    private_suffixes = (".db", ".db-wal", ".db-shm", ".sqlite", ".sqlite3", ".eml", ".mbox", ".p12", ".pfx", ".key", ".pem", ".jsonl", ".dmg")
    for relative in sorted(files):
        path = ROOT / relative
        if not path.is_file():
            continue  # a tracked file may have been deleted in the worktree
        name = str(relative)
        if name.startswith(("build/", "dist/", "node_modules/", ".mygo/", ".workbuddy/")) or name.endswith(private_suffixes) or (relative.name.startswith(".env") and relative.name != ".env.example"):
            errors.append(f"{name}: local data/build/credential file must not be published")
            continue
        raw = path.read_bytes()
        if b"\0" in raw:
            continue
        try:
            text = raw.decode("utf8")
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(text.splitlines(), 1):
            # Match actual absolute home/tmp paths, not the detector's source regex.
            if re.search(r"/(?:Users|home)/[\w.-]+/|/var/folders/[\w/.-]+", line):
                errors.append(f"{name}:{number}: machine-specific absolute path")
        if path.suffix == ".md":
            links = re.findall(r'!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)', text)
            links += re.findall(r'(?:src|href)="([^"]+)"', text)
            for link in links:
                url = urlsplit(link.strip("<>"))
                if url.scheme or url.netloc or not url.path:
                    continue
                target = path.parent / unquote(url.path)
                if not target.exists():
                    errors.append(f"{name}: broken local link: {url.path}")

    for workflow in sorted((ROOT / ".github/workflows").glob("*.yml")):
        for number, line in enumerate(workflow.read_text().splitlines(), 1):
            match = re.search(r"uses:\s*([\w.-]+/[\w./-]+)@([^\s]+)", line)
            if match and not re.fullmatch(r"[0-9a-f]{40}", match[2]):
                errors.append(f"{workflow.relative_to(ROOT)}:{number}: pin external Actions to a full commit SHA")

    if errors:
        print("Repository checks failed:\n" + "\n".join("- " + item for item in errors))
        return 1
    print("Repository checks passed: versions, local links, public-file boundaries and Action pins.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
