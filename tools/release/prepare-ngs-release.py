#!/usr/bin/env python3
"""Create an immutable Local source candidate. No publication or deployment here."""

import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile

REPOSITORY = "pvenus/ngs-platform"
WORKFLOW = ".github/workflows/prepare-ngs-release.yml"
REF = "refs/heads/main"
NODE = "24.21.0"
ARCHIVE = "ngs-local.tar"
PREFIX = "ngs-local/"
OVERLAY = "space-hosting/overlay"
LOCAL_SCOPE = (
    r"README\.md|package(?:-lock)?\.json|source-manifest\.json|"
    r"(?:dev/[A-Za-z0-9._-]+\.(?:sql|json)|docs/[A-Za-z0-9._-]+\.md|"
    r"local-miniflare/(?:README\.md|package(?:-lock)?\.json)|"
    r"sites/npcgen/build/[A-Za-z0-9._-]+\.(?:mjs|mts|js|html|css)|"
    r"sites/npcgen/tests/[A-Za-z0-9._-]+\.mjs)"
)
SHA1 = re.compile(r"[a-f0-9]{40}")
DIGEST = re.compile(r"[a-f0-9]{64}")
DECIMAL = re.compile(r"[1-9][0-9]{0,19}")
MAX_ARCHIVE = 32 * 1024 * 1024


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def text(value):
    return value.decode("utf-8", errors="strict").strip()


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate manifest entry")
        result[key] = value
    return result


def local_tree(root, head):
    tracked = git(root, "ls-tree", "-r", "-z", head, "--", "ngs-local")
    paths = set()
    for row in tracked.split(b"\0"):
        if not row:
            continue
        flags, path_bytes = row.split(b"\t", 1)
        path = path_bytes.decode("utf-8", errors="strict")
        mode, kind, _oid = flags.split()
        if (
            mode != b"100644"
            or kind != b"blob"
            or not path.startswith(PREFIX)
            or not re.fullmatch(LOCAL_SCOPE, path[len(PREFIX):])
            or re.search(r"(?:^|/|\.)private(?:\.|/|$)", path, re.I)
        ):
            raise ValueError("unexpected file in Local git tree")
        paths.add(path[len(PREFIX):])
    if not paths:
        raise ValueError("missing Local source tree")
    return paths


def verify_tar(raw, expected):
    if len(raw) > MAX_ARCHIVE:
        raise ValueError("source archive exceeds expected size")
    actual = {}
    directories = {str(parent) for name in expected for parent in Path(name).parents if str(parent) != "."}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
        for member in tar:
            if member.isdir() and member.name in directories:
                continue
            if not member.isfile() or member.name not in expected or member.name in actual:
                raise ValueError("unexpected archive member")
            actual[member.name] = tar.extractfile(member).read()
    if set(actual) != expected:
        raise ValueError("source archive differs from committed tree")
    index = json.loads(actual.pop("source-manifest.json"), object_pairs_hook=unique)
    if not isinstance(index, dict) or not isinstance(index.get("files"), dict):
        raise ValueError("invalid checked-in source manifest")
    files = index["files"]
    if any(not isinstance(d, str) or not DIGEST.fullmatch(d) for d in files.values()):
        raise ValueError("invalid checked-in source digest")
    if files != {k: sha256(v) for k, v in actual.items()}:
        raise ValueError("checked-in source manifest differs from archive")


def prepare(root, out, env, node_version):
    head = env.get("GITHUB_SHA", "")
    run = env.get("GITHUB_RUN_ID", "")
    attempt = env.get("GITHUB_RUN_ATTEMPT", "")
    if (
        env.get("GITHUB_REPOSITORY") != REPOSITORY
        or env.get("GITHUB_WORKFLOW_REF") != REPOSITORY + "/" + WORKFLOW + "@" + REF
        or env.get("GITHUB_EVENT_NAME") != "push"
        or env.get("GITHUB_REF") != REF
        or not SHA1.fullmatch(head)
        or not DECIMAL.fullmatch(run)
        or not DECIMAL.fullmatch(attempt)
        or node_version != "v" + NODE
        or text(git(root, "rev-parse", "HEAD")) != head
    ):
        raise ValueError("untrusted candidate run or mismatched checkout")
    git(root, "diff", "--quiet", "HEAD", "--", "ngs-local", OVERLAY)
    overlay = text(git(root, "rev-parse", head + ":" + OVERLAY))
    if not SHA1.fullmatch(overlay) or text(git(root, "cat-file", "-t", overlay)) != "tree":
        raise ValueError("missing checked-in Space source")
    entries = local_tree(root, head)
    # A subtree object has no timestamp. Pin tar member mtime to its parent commit.
    commit_time = text(git(root, "show", "-s", "--format=%cI", head))
    body = git(root, "archive", "--format=tar", "--mtime=" + commit_time, head + ":ngs-local")
    verify_tar(body, entries)
    manifest = {
        "schemaVersion": "ngs.ops-release.v1",
        "repository": REPOSITORY,
        "workflow": WORKFLOW,
        "headSha": head,
        "runId": run,
        "runAttempt": attempt,
        "nodeVersion": NODE,
        "archive": {"file": ARCHIVE, "sha256": sha256(body), "bytes": len(body)},
        "spaceOverlay": {"path": OVERLAY, "treeSha": overlay, "validation": "source-only"},
    }
    out.mkdir(mode=0o700, exist_ok=False)
    (out / ARCHIVE).write_bytes(body)
    (out / "release.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: prepare-ngs-release.py OUTPUT-directory")
    runtime = subprocess.check_output(["node", "--version"], text=True).strip()
    prepare(Path(__file__).resolve().parents[2], Path(sys.argv[1]), os.environ, runtime)
