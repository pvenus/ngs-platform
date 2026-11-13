"""Prepare a pinned private standalone Python. No global installation or activation."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request

import archive_common as safe

MANIFEST = Path(__file__).resolve().with_name('trusted-python.lock.json')


def load_manifest():
    value = json.loads(MANIFEST.read_text(), object_pairs_hook=safe.unique)
    if (value.get('schemaVersion') != 'ngs.trusted-python.v1' or value.get('version') != '3.12.14'
            or value.get('build') != '20260901' or value.get('architecture') != 'arm64'
            or value.get('platform') != 'darwin'):
        raise ValueError('PYTHON_MANIFEST_INVALID')
    fixed = {
        'url': 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-aarch64-apple-darwin-install_only_stripped.tar.gz',
        'sha256': '81a359f1cfadd4da11766534c5913791cea55f26e1bb902cacd2a531bb1e4b2b',
        'archiveRoot': 'python',
        'interpreter': 'python/bin/python3.12',
        'licenseFile': 'python/lib/python3.12/LICENSE.txt',
    }
    if any(value.get(key) != expected for key, expected in fixed.items()):
        raise ValueError('PYTHON_MANIFEST_PIN_MISMATCH')
    for key, maximum in {'maxArchiveBytes': 67108864,
                         'maxExpandedBytes': 1073741824,
                         'maxMembers': 100000}.items():
        limit = value.get(key)
        if type(limit) is not int or not 1 <= limit <= maximum:
            raise ValueError('PYTHON_MANIFEST_LIMIT_INVALID')
    return value


def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())


def private_destination(value):
    root = Path(value).expanduser()
    if not root.is_absolute() or '..' in root.parts or any(ord(c) < 32 for c in str(root)):
        raise ValueError('PYTHON_NEW_ABSOLUTE_ROOT_REQUIRED')
    safe.checked(root.parent)
    # Executable ancestry must also be protected, unlike a generic temporary dir.
    for p in root.parents:
        s = p.stat()
        if s.st_uid not in (0, os.getuid()) or s.st_mode & 0o022:
            raise ValueError('PYTHON_UNTRUSTED_PARENT')
    if os.path.lexists(root):
        raise ValueError('PYTHON_ROOT_EXISTS_NO_OVERWRITE')
    return root


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urllib.parse.urlsplit(newurl)
        if (url.scheme != 'https' or url.username or url.password or url.port not in (None, 443)
                or url.hostname not in ('github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com')):
            raise ValueError('PYTHON_DOWNLOAD_REDIRECT_DENIED')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(path, manifest):
    # Only the exact pinned initial URL; never ambient proxies, cookies or credentials.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), OfficialRedirect())
    request = urllib.request.Request(manifest['url'], headers={'User-Agent': 'NGS-private-runtime-setup/1'})
    with opener.open(request, timeout=60) as response, path.open('xb') as out:
        if response.status != 200:
            raise ValueError('PYTHON_DOWNLOAD_STATUS')
        count = 0
        while True:
            data = response.read(1024 * 1024)
            if not data: break
            count += len(data)
            if count > manifest['maxArchiveBytes']:
                raise ValueError('PYTHON_ARCHIVE_TOO_LARGE')
            out.write(data)
        out.flush(); os.fsync(out.fileno())


def verified_copy(source, target, manifest):
    # Private snapshot prevents archive changes between hash check and extraction.
    source = safe.checked(source, directory=False)
    if source.stat().st_nlink != 1 or source.stat().st_size > manifest['maxArchiveBytes']:
        raise ValueError('PYTHON_ARCHIVE_INVALID')
    digest = hashlib.sha256()
    with source.open('rb') as inp, target.open('xb') as out:
        size = 0
        while True:
            data = inp.read(1024 * 1024)
            if not data: break
            size += len(data)
            if size > manifest['maxArchiveBytes']: raise ValueError('PYTHON_ARCHIVE_TOO_LARGE')
            digest.update(data); out.write(data)
        out.flush(); os.fsync(out.fileno())
    if digest.hexdigest() != manifest['sha256']:
        raise ValueError('PYTHON_ARCHIVE_HASH_MISMATCH')


def extract_archive(archive, destination, manifest):
    """Caller must hash its private snapshot first. No extractall or executable code."""
    with tarfile.open(archive, mode='r:*') as tar:
        members = []; names = set(); expanded = 0
        for item in tar:
            if len(members) >= manifest['maxMembers']:
                raise ValueError('PYTHON_TAR_MEMBER_LIMIT')
            name = item.name.rstrip('/')
            path = PurePosixPath(name)
            if (not name or path.is_absolute() or '..' in path.parts or str(path) != name
                    or path.parts[0] != manifest['archiveRoot'] or name in names
                    or any(ord(c) < 32 for c in name) or '\\' in name):
                raise ValueError('PYTHON_TAR_PATH_INVALID')
            if not (item.isdir() or item.isfile() or item.issym()) or item.mode & 0o7000:
                raise ValueError('PYTHON_TAR_SPECIAL_FILE_DENIED')
            if item.size < 0: raise ValueError('PYTHON_TAR_SIZE_INVALID')
            expanded += item.size
            if expanded > manifest['maxExpandedBytes']:
                raise ValueError('PYTHON_TAR_SIZE_LIMIT')
            names.add(name); members.append((name, item))
        links = {name for name, item in members if item.issym()}
        for name, item in members:
            if any(str(parent) in links for parent in PurePosixPath(name).parents):
                raise ValueError('PYTHON_TAR_SYMLINK_PARENT')
            if item.issym():
                target = PurePosixPath(item.linkname)
                if target.is_absolute() or not item.linkname or '\\' in item.linkname or any(ord(c)<32 for c in item.linkname):
                    raise ValueError('PYTHON_TAR_LINK_ESCAPE')
                # Resolve lexically, with symlink chains checked again after creation.
                parts = list(PurePosixPath(name).parent.parts)
                for part in target.parts:
                    if part == '..':
                        if len(parts) <= 1: raise ValueError('PYTHON_TAR_LINK_ESCAPE')
                        parts.pop()
                    elif part != '.': parts.append(part)
                if '/'.join(parts) not in names:
                    raise ValueError('PYTHON_TAR_LINK_TARGET_MISSING')
        destination.mkdir(mode=0o700)
        for name, item in members:
            if item.issym(): continue
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if item.isdir(): path.mkdir(exist_ok=True, mode=0o700)
            else:
                with tar.extractfile(item) as inp, path.open('xb') as out:
                    shutil.copyfileobj(inp, out)
                path.chmod(0o700 if item.mode & 0o111 else 0o600)
        for name, item in members:
            if item.issym():
                path = destination / name; path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                path.symlink_to(item.linkname)
        for name in links:
            try: target = (destination / name).resolve(strict=True)
            except (OSError, RuntimeError) as exc: raise ValueError('PYTHON_TAR_LINK_INVALID') from exc
            if not target.is_relative_to(destination / manifest['archiveRoot']):
                raise ValueError('PYTHON_TAR_LINK_ESCAPE')


def extract_verified(archive, destination, manifest):
    extract_archive(archive, destination, manifest)
    interpreter = destination / manifest['interpreter']
    if interpreter.is_symlink() or not interpreter.is_file() or not os.access(interpreter, os.X_OK):
        raise ValueError('PYTHON_INTERPRETER_MISSING')
    if not (destination / manifest['licenseFile']).is_file():
        raise ValueError('PYTHON_LICENSE_MISSING')
    # uv-created installed trees can carry BUILD; the official install_only
    # archive does not. The exact verified archive hash is the build authority.
    build_file = destination / manifest['archiveRoot'] / 'BUILD'
    if build_file.exists() and build_file.read_text().strip() != manifest['build']:
        raise ValueError('PYTHON_BUILD_MISMATCH')


def prepare(*, root, archive=None, download_requested=False, apply=False):
    manifest = load_manifest(); root = private_destination(root)
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('PYTHON_MAC_ARM64_REQUIRED')
    if archive is not None and download_requested:
        raise ValueError('PYTHON_ARCHIVE_OR_DOWNLOAD_NOT_BOTH')
    if apply and archive is None and not download_requested:
        raise ValueError('PYTHON_EXPLICIT_ARCHIVE_OR_DOWNLOAD_REQUIRED')
    intent = root.with_name(root.name + '.python-setup-intent.json')
    if os.path.lexists(intent): raise ValueError('PYTHON_INTENT_EXISTS_INSPECT_NO_RETRY')
    result = dict(schemaVersion='ngs.trusted-python-preparation.v1', state='plan-only',
                  root=str(root), interpreter=str(root / manifest['interpreter']),
                  version=manifest['version'], build=manifest['build'],
                  buildAuthority='pinned-official-archive-sha256', archiveSha256=manifest['sha256'],
                  downloadUrl=manifest['url'], modifiesGlobalPaths=False, changesBindings=False,
                  downloadsModels=False, runsInterpreter=False, activationReady=False)
    if not apply and not download_requested: return result
    # --download itself is explicit application authorization; --archive needs --apply.
    write_new(intent, {**result, 'state': 'started-no-auto-retry'})
    stage = Path(tempfile.mkdtemp(prefix='.python-setup-', dir=root.parent)); stage.chmod(0o700)
    completed = False
    try:
        original = stage / 'download.tar.gz'
        if download_requested:
            download(original, manifest)
        else:
            original = Path(archive).expanduser()
        snapshot = stage / 'verified.tar.gz'
        verified_copy(original, snapshot, manifest)
        payload = stage / 'payload'
        extract_verified(snapshot, payload, manifest)
        result['state'] = 'python-prepared-not-activated'
        write_new(payload / 'PYTHON-PREPARATION.json', {**result, 'manifest': manifest})
        safe.install_absent(payload, root)
        completed = True
        return result
    finally:
        if completed:
            shutil.rmtree(stage) # Only owned temporary bytes after successful publication.
        # Preserve failed private archive/extraction bytes and intent for inspection.


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', required=True); p.add_argument('--archive')
    p.add_argument('--download', action='store_true', dest='download_requested')
    p.add_argument('--apply', action='store_true')
    try:
        print(json.dumps(prepare(**vars(p.parse_args())), indent=2)); return 0
    except (OSError, ValueError, tarfile.TarError) as exc:
        print(json.dumps({'state': 'blocked', 'error': str(exc)})); return 2


if __name__ == '__main__': sys.exit(main())
