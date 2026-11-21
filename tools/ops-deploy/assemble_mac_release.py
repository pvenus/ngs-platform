"""Build the private package after GitHub verification, never select/start it."""
import fcntl
import hashlib
import io
import json
import os
import plistlib
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tarfile
import tempfile
from urllib.parse import urlsplit

SHA = re.compile(r"[0-9a-f]{40}")
ENTRY = Path("sites/npcgen/build/local-miniflare-app.mjs")
STARTUP = (ENTRY, ENTRY.with_name("local-miniflare-runtime.mjs"),
           ENTRY.with_name("local-miniflare-worker.mjs"), ENTRY.with_name("local-request-queue.mjs"),
           Path("dev/0014_space_file_replica_versions.sql"), Path("dev/0015_replica_sync_progress.sql"),
           Path("local-miniflare/package-lock.json"), Path("local-miniflare/package.json"))
LABEL = "com.vinus.ngs.local-mcp"
NODE_VERSION = "24.21.0"
ACTIVE_QUEUE = Path.home() / "Workspaces/NGS/data/local-request-queue/queue.sqlite"
EXTERNAL_VOLUME = Path("/Volumes/무제")
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
A_PATH = re.compile(r"README\.md|package(?:-lock)?\.json|source-manifest\.json|"
                    r"dev/[A-Za-z0-9._-]+\.(?:sql|json)|docs/[A-Za-z0-9._-]+\.md|"
                    r"local-miniflare/(?:README\.md|package(?:-lock)?\.json)|"
                    r"sites/npcgen/build/[A-Za-z0-9._-]+\.(?:mjs|mts|js|html|css)|"
                    r"sites/npcgen/tests/[A-Za-z0-9._-]+\.mjs")


class AssemblyError(ValueError):
    pass


def need(value, code):
    if not value:
        raise AssemblyError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_dir(path):
    s = path.lstat()
    need(path.resolve() == path and stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid()
         and stat.S_IMODE(s.st_mode) == 0o700, "PRIVATE_ASSEMBLY_DIRECTORY_REQUIRED")


def read_prior(path, expected):
    s = path.lstat()
    need(path.resolve() == path and stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid()
         and s.st_nlink == 1 and not s.st_mode & 0o022, "PRIOR_SELECTOR_FILE_INVALID")
    value = path.read_bytes()
    need(digest(value) == expected, "PRIOR_SELECTOR_CHANGED")
    return plistlib.loads(value)


def archive_files(verified):
    raw, files = verified["raw"], verified["files"]
    need(isinstance(raw, bytes) and 1024 <= len(raw) <= MAX_ARCHIVE_BYTES
         and verified["evidence"]["archiveSha256"] == digest(raw), "VERIFIED_ARCHIVE_CHANGED")
    need(type(files) is dict and 0 < len(files) < 1024
         and all(type(v) is bytes and A_PATH.fullmatch(k)
                 and not re.search(r"(?:^|/|\.)private(?:\.|/|$)", k, re.I)
                 for k, v in files.items()), "ARCHIVE_SOURCE_PATH_INVALID")
    parents = {p.as_posix() for k in files for p in PurePosixPath(k).parents}
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
        for m in tar:
            k = m.name
            need(k not in seen and len(seen) < 1024, "ARCHIVE_MEMBER_DUPLICATE")
            seen.add(k)
            if m.isdir():
                need(k != "." and k in parents, "ARCHIVE_DIRECTORY_OUTSIDE_SCOPE")
            else:
                need(m.isfile() and k in files and m.size == len(files[k])
                     and tar.extractfile(m).read() == files[k], "ARCHIVE_MEMBER_MISMATCH")
    need(files.keys() <= seen and "source-manifest.json" in files, "ARCHIVE_FILES_MISSING")
    source_manifest = json.loads(files["source-manifest.json"])
    need(source_manifest.get("files") ==
         {k: digest(v) for k, v in files.items() if k != "source-manifest.json"}, "SOURCE_MANIFEST_MISMATCH")
    return files


def lock_packages(files):
    manifest = json.loads(files["local-miniflare/package.json"])
    lock = json.loads(files["local-miniflare/package-lock.json"])
    pkgs = lock["packages"]
    root = pkgs[""]
    deps = manifest.get("dependencies")
    need(lock["lockfileVersion"] == 3 and manifest.get("private") is True
         and type(deps) is dict and set(deps) == {"miniflare"}
         and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", deps["miniflare"])
         and root.get("dependencies") == deps and not manifest.get("scripts")
         and pkgs["node_modules/miniflare"]["version"] == deps["miniflare"]
         and "node_modules/workerd" in pkgs,
         "MINIFLARE_DEPENDENCY_MANIFEST_INVALID")
    for name, row in pkgs.items():
        if not name:
            continue
        need(re.fullmatch(r"(?:node_modules/(?:@[a-z0-9._-]+/)?[a-zA-Z0-9_-][a-zA-Z0-9._-]*/?)+", name)
             and all(k not in ("", ".", "..") for k in name.split("/")) and row.get("link") is not True
             and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?", row["version"])
             and re.fullmatch(r"sha512-[A-Za-z0-9+/]{86}==", row["integrity"]),
             "MINIFLARE_LOCK_ENTRY_INVALID")
        package = name.rsplit("node_modules/", 1)[1]
        unscoped = package.rsplit("/", 1)[-1]
        remote = urlsplit(row["resolved"])
        need(remote.scheme == "https" and remote.netloc == "registry.npmjs.org"
             and not remote.query and not remote.fragment
             and remote.path == f"/{package}/-/{unscoped}-{row['version']}.tgz", "NPM_ORIGIN_DENIED")
    return pkgs


def prior_release(plist, releases, scratch, node, queue):
    args = plist["ProgramArguments"]
    env = plist["EnvironmentVariables"]
    old = Path(args[1]).parents[3]
    need(plist["Label"] == LABEL and args == [str(node), str(old / ENTRY)]
         and old.parent == releases and re.fullmatch(r"project-page-github-[0-9a-f]{7,40}", old.name)
         and Path(plist["WorkingDirectory"]).parent == scratch
         and env.get("NGS_REQUEST_QUEUE_DB") == str(queue)
         and env.get("NGS_PROJECT_LISTEN_PORT") == "5274" and env.get("NGS_REQUEST_QUEUE_MCP_PORT") == "5275"
         and env.get("NGS_FILE_SYNC_MODE") == "push" and env.get("NGS_FILE_SYNC_PROJECTS") == "binari"
         and env.get("NGS_LOCAL_MINIFLARE_ROOT")
         and not {"NGS_LOCAL_S3_CONFIG", "NGS_LOCAL_REPLICA_DB"} & env.keys(), "PRIOR_NOT_NATIVE_COMBINED")
    scope = Path(env["NGS_LOCAL_MINIFLARE_ROOT"])
    need(scope.parent == EXTERNAL_VOLUME and EXTERNAL_VOLUME.is_mount()
         and scope.name.startswith("NGS-Miniflare-") and scope.stat().st_dev == EXTERNAL_VOLUME.stat().st_dev,
         "PRIOR_NATIVE_STORAGE_UNAVAILABLE")
    private_dir(scope)
    private_dir(old)
    return old


def npm_install(tree, node, cache, sandbox):
    # Absolute pinned standard Node/npm. Strip all inherited credentials/configuration.
    prefix = node.parent.parent
    npm = prefix / "lib/node_modules/npm/bin/npm-cli.js"
    need(node.resolve() == node and node.is_file() and npm.resolve() == npm and npm.is_file(),
         "PINNED_NODE_NPM_UNAVAILABLE")
    private_dir(cache)
    npmhome = sandbox / "npm-home"
    npmhome.mkdir(mode=0o700)
    (npmhome / "user.conf").touch(mode=0o600)
    (npmhome / "global.conf").touch(mode=0o600)
    env = {"HOME": str(npmhome), "PATH": str(node.parent) + ":/usr/bin:/bin",
           "TMPDIR": str(npmhome), "LANG": "C", "NPM_CONFIG_UPDATE_NOTIFIER": "false"}
    version = subprocess.check_output([str(node), "--version"], env=env, text=True, timeout=8)
    need(version.strip() == "v" + NODE_VERSION, "PINNED_NODE_VERSION_DRIFT")
    command = [str(node), str(npm), "ci", "--ignore-scripts", "--offline", "--no-audit", "--no-fund",
               "--registry=https://registry.npmjs.org/", "--userconfig=" + str(npmhome / "user.conf"),
               "--globalconfig=" + str(npmhome / "global.conf"), "--cache=" + str(cache)]
    completed = subprocess.run(command, cwd=tree / "local-miniflare", env=env, stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120, umask=0o077)
    need(completed.returncode == 0, "PINNED_NPM_CACHE_OR_INSTALL_UNAVAILABLE")


def check_deps(tree, packages):
    base = tree / "local-miniflare"
    depdir = base / "node_modules"
    required = {"node_modules/miniflare", "node_modules/workerd"}
    if os.uname().machine == "arm64":
        required.add("node_modules/@cloudflare/workerd-darwin-arm64")
    for name, row in packages.items():
        if not name:
            continue
        p = base / name / "package.json"
        if row.get("optional") is True and name not in required and not p.exists():
            continue
        need(p.resolve() == p and p.is_file() and json.loads(p.read_bytes()).get("version") == row["version"],
             "INSTALLED_NPM_LOCK_DRIFT")
    for p in depdir.rglob("*"):
        if p.is_symlink():
            need(p.resolve(strict=True).is_relative_to(depdir), "DEPENDENCY_LINK_ESCAPED")
        else:
            s = p.lstat()
            need(s.st_uid == os.getuid() and not s.st_mode & 0o022
                 and (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)), "DEPENDENCY_MODE_INVALID")


def assemble_verified(verified, *, control, releases, scratch, prior_plist, expected_prior_sha256, node, npm_cache,
                      queue=ACTIVE_QUEUE, _install=npm_install, _prior=prior_release):
    """Return unselected (source_root, execution_root); never publish OPS readiness."""
    head = verified["head"]
    need(type(head) is str and SHA.fullmatch(head), "VERIFIED_COMMIT_INVALID")
    for p in (control, releases, scratch):
        private_dir(p)
    source = releases / ("project-page-github-" + head)
    execution = scratch / head
    f = os.open(control, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(not os.path.lexists(source) and not os.path.lexists(execution), "ASSEMBLY_ALREADY_EXISTS")
        prior = read_prior(prior_plist, expected_prior_sha256)
        old = _prior(prior, releases, scratch, node, queue)
        files = archive_files(verified)
        packages = lock_packages(files)
        need(all(n.as_posix() in files and (old / n).read_bytes() == files[n.as_posix()] for n in STARTUP),
             "NATIVE_SCHEMA_OR_RUNTIME_CHANGE_OUTSIDE_SCOPE")
        with tempfile.TemporaryDirectory(prefix=".ops-ngs-assembly-", dir=releases) as temp:
            sandbox = Path(temp)
            tree = sandbox / "source"
            tree.mkdir(mode=0o700)
            for relative, data in files.items():
                output = tree.joinpath(*PurePosixPath(relative).parts)
                output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with output.open("xb") as stream:
                    stream.write(data)
                output.chmod(0o600)
            _install(tree, node, npm_cache, sandbox)
            check_deps(tree, packages)
            deps = tree / "local-miniflare/node_modules"
            need({p.relative_to(tree).as_posix() for p in tree.rglob("*")
                  if (p.is_file() or p.is_symlink()) and not p.is_relative_to(deps)} == files.keys()
                 and all(not (tree / name).is_symlink() and (tree / name).read_bytes() == content
                         for name, content in files.items()), "INSTALLED_SOURCE_CHANGED")
            read_prior(prior_plist, expected_prior_sha256)
            execution.mkdir(mode=0o700)
            # Only participating trusted preparers may write these owner-private paths.
            # A completed private tree is made visible all at once, but remains unselected.
            need(not os.path.lexists(source), "ASSEMBLY_ALREADY_EXISTS")
            os.rename(tree, source)
        return source, execution
    finally:
        os.close(f)
