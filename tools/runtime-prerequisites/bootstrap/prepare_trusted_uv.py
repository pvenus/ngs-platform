"""Prepare a new private pinned uv tool directory, without running uv or changing PATH."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import tarfile
import tempfile

import archive_common as safe
import prepare_trusted_python as archive_tools

MANIFEST = Path(__file__).resolve().with_name('trusted-uv.lock.json')
URL = 'https://github.com/astral-sh/uv/releases/download/0.13.7/uv-aarch64-apple-darwin.tar.gz'
SHA256 = '81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731'
# Layout verified from the official archive after matching its pinned checksum.
LAYOUT = {'archiveRoot': 'uv-aarch64-apple-darwin',
          'executables': {'uv': 'uv-aarch64-apple-darwin/uv', 'uvx': 'uv-aarch64-apple-darwin/uvx'},
          'licenseFiles': ['notices/LICENSE-MIT', 'notices/LICENSE-APACHE']}
NOTICE_PINS = {'LICENSE-MIT': '860e3d7a86b84e6a7012c7a635fc64df475cebc6cce34dfeb73a5982ec58176c', 'LICENSE-APACHE': 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4'}


def load_manifest():
    value = json.loads(MANIFEST.read_text(), object_pairs_hook=safe.unique)
    expected = dict(schemaVersion='ngs.trusted-uv.v1', version='0.13.7',
                    platform='darwin', architecture='arm64', url=URL, sha256=SHA256, **LAYOUT)
    if not LAYOUT or any(value.get(k) != v for k,v in expected.items()):
        raise ValueError('UV_MANIFEST_PIN_MISMATCH')
    for key, maximum in {'maxArchiveBytes': 67108864, 'maxExpandedBytes': 268435456, 'maxMembers': 100}.items():
        if type(value.get(key)) is not int or not 1 <= value[key] <= maximum:
            raise ValueError('UV_MANIFEST_LIMIT_INVALID')
    if set(value.get('notices', {})) != set(NOTICE_PINS) or len(NOTICE_PINS) != 2:
        raise ValueError('UV_NOTICE_SET_INVALID')
    for name, digest in NOTICE_PINS.items():
        notice = value['notices'][name]
        if (notice.get('url') != 'https://raw.githubusercontent.com/astral-sh/uv/0.13.7/' + name
                or notice.get('sha256') != digest
                or notice.get('bundledPath') != 'notices/uv-0.13.7/' + name
                or type(notice.get('bytes')) is not int
                or notice['bytes'] != {'LICENSE-MIT':1077,'LICENSE-APACHE':11357}[name]):
            raise ValueError('UV_NOTICE_PIN_MISMATCH')
    for name in NOTICE_PINS:
        notice_bytes(name, value)
    return value


def notice_bytes(name, manifest):
    path = safe.checked(Path(__file__).resolve().parent / manifest['notices'][name]['bundledPath'], directory=False)
    raw = path.read_bytes()
    if len(raw) != manifest['notices'][name]['bytes'] or hashlib.sha256(raw).hexdigest() != NOTICE_PINS[name]:
        raise ValueError('UV_BUNDLED_NOTICE_HASH_MISMATCH')
    return raw


def extract_verified(archive, destination, manifest):
    expected = {manifest['archiveRoot'], *manifest['executables'].values()}
    with tarfile.open(archive, 'r:gz') as tar:
        names = []
        for member in tar:
            names.append(member.name.rstrip('/'))
            if len(names) > 3:
                raise ValueError('UV_ARCHIVE_MEMBER_SET')
        if len(names) != 3 or set(names) != expected:
            raise ValueError('UV_ARCHIVE_MEMBER_SET')
    archive_tools.extract_archive(archive, destination, manifest)
    for name in ('uv', 'uvx'):
        p = destination / manifest['executables'][name]
        if p.is_symlink() or not p.is_file() or not os.access(p, os.X_OK):
            raise ValueError('UV_EXECUTABLE_MISSING')
    # Archive contains uv/uvx only. These separately pinned official notices are
    # preserved from the manifest, never represented as original archive members.
    (destination / 'notices').mkdir(mode=0o700)
    for name, notice in manifest['notices'].items():
        path = destination / 'notices' / name
        with path.open('xb') as stream:
            os.fchmod(stream.fileno(), 0o600); stream.write(notice_bytes(name, manifest))
    for name in manifest['licenseFiles']:
        p = destination / name
        if p.is_symlink() or not p.is_file() or p.stat().st_size == 0:
            raise ValueError('UV_LICENSE_MISSING')


def prepare(*, root, archive=None, download_requested=False, apply=False):
    manifest = load_manifest()
    root = archive_tools.private_destination(root)
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('UV_MAC_ARM64_REQUIRED')
    if archive is not None and download_requested:
        raise ValueError('UV_ARCHIVE_OR_DOWNLOAD_NOT_BOTH')
    if apply and archive is None and not download_requested:
        raise ValueError('UV_EXPLICIT_ARCHIVE_OR_DOWNLOAD_REQUIRED')
    intent = root.with_name(root.name + '.uv-setup-intent.json')
    if os.path.lexists(intent):
        raise ValueError('UV_INTENT_EXISTS_INSPECT_NO_RETRY')
    result = dict(schemaVersion='ngs.trusted-uv-preparation.v1', state='plan-only',
                  root=str(root), uv=str(root / manifest['executables']['uv']),
                  uvx=str(root / manifest['executables']['uvx']), version=manifest['version'],
                  archiveSha256=SHA256, downloadUrl=URL, modifiesGlobalPaths=False,
                  changesBindings=False, downloadsModels=False, runsTool=False, activationReady=False)
    if not apply and not download_requested:
        return result
    archive_tools.write_new(intent, {**result, 'state': 'started-no-auto-retry'})
    stage = Path(tempfile.mkdtemp(prefix='.uv-setup-', dir=root.parent)); stage.chmod(0o700)
    try:
        original = stage / 'download.tar.gz'
        if download_requested:
            archive_tools.download(original, manifest)
        else:
            original = Path(archive).expanduser()
        snapshot = stage / 'verified.tar.gz'
        archive_tools.verified_copy(original, snapshot, manifest)
        payload = stage / 'payload'
        extract_verified(snapshot, payload, manifest)
        result['state'] = 'uv-prepared-not-activated'
        archive_tools.write_new(payload / 'UV-PREPARATION.json', {**result, 'manifest': manifest})
        safe.install_absent(payload, root)
        return result
    finally:
        shutil.rmtree(stage)


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
