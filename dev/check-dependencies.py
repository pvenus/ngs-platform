"""Snapshot verification by default; explicit portable npm-install metadata checks."""
from pathlib import Path
import argparse
import json
import sys


def check_lock_install(app):
    """Check install consistency, NOT a replacement for npm ci tarball integrity."""
    app = Path(app).absolute()
    modules = app / 'node_modules'
    if modules.is_symlink() or not modules.is_dir():
        return ['NODE_MODULES_INVALID']
    if (modules / '.package-lock.json').is_symlink():
        return ['INSTALLED_LOCK_SYMLINK_DENIED']
    lock = json.loads((app / 'package-lock.json').read_text())['packages']
    installed = json.loads((modules / '.package-lock.json').read_text())['packages']
    bad = []
    allowed_bins = {}
    for rel, info in installed.items():
        parts = Path(rel).parts
        if not parts or parts[0] != 'node_modules' or '..' in parts:
            bad.append('PACKAGE_PATH_INVALID:' + rel)
            continue
        expected = lock.get(rel)
        if expected is None or any(info.get(k) != expected.get(k) for k in ('version', 'integrity', 'resolved')):
            bad.append('PACKAGE_LOCK_MISMATCH:' + rel)
            continue
        package = app / rel
        if package.is_symlink() or not package.is_dir():
            bad.append('PACKAGE_MISSING_OR_LINKED:' + rel)
            continue
        try:
            actual = json.loads((package / 'package.json').read_text())
            if actual.get('version') != expected.get('version'):
                bad.append('PACKAGE_VERSION_MISMATCH:' + rel)
        except (OSError, ValueError):
            bad.append('PACKAGE_JSON_INVALID:' + rel)
        bins = expected.get('bin', {})
        if not isinstance(bins, dict):
            bad.append('BIN_DECLARATION_INVALID:' + rel)
            continue
        # Scoped packages install executables alongside their enclosing node_modules.
        bin_root = package.parent.parent if package.parent.name.startswith('@') else package.parent
        for name, target in bins.items():
            if not isinstance(target, str) or Path(name).name != name or name in ('.', '..'):
                bad.append('BIN_DECLARATION_INVALID:' + rel)
                continue
            destination = (package / target).resolve()
            if not destination.is_relative_to(package.resolve()):
                bad.append('BIN_TARGET_ESCAPE:' + rel)
                continue
            allowed_bins.setdefault(bin_root / '.bin' / name, set()).add(destination)
    for rel, info in lock.items():
        if rel and not info.get('optional') and rel not in installed:
            bad.append('REQUIRED_PACKAGE_MISSING:' + rel)
    for path in modules.rglob('*'):
        if path.is_symlink():
            target = path.resolve()
            if (path not in allowed_bins or target not in allowed_bins[path]
                    or not target.is_relative_to(modules.resolve()) or not target.is_file()):
                bad.append('SYMLINK_DENIED:' + str(path.relative_to(modules)))
    return bad


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('snapshot', 'lock-install'), default='snapshot')
    args = parser.parse_args()
    if args.mode == 'lock-install':
        app = Path(__file__).resolve().parents[1] / 'sites/npcgen'
        try:
            bad = check_lock_install(app)
        except (OSError, ValueError, RuntimeError) as error:
            print(json.dumps({'mode': args.mode, 'error': str(error)}))
            return 1
        print(json.dumps({'mode': args.mode, 'missingOrChanged': len(bad), 'examples': bad[:8],
                          'contentIntegrity': 'npm-ci-responsibility-not-verified-here'}))
        return bool(bad)
    return check_snapshot()


def check_snapshot():
    from pathlib import Path
    import hashlib,json,sys
    root=Path(__file__).resolve().parents[1];app=root/'sites/npcgen';modules=app/'node_modules';proof=json.loads((root/'dev/dependency-manifest.json').read_text());bad=[]
    def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
    for rel,h in proof['files'].items():
     p=modules/rel
     if p.is_symlink() or not p.is_file() or sha(p)!=h:bad.append(rel)
    for p in modules.rglob('*'):
     if p.is_symlink():bad.append('SYMLINK:'+str(p.relative_to(modules)))
    assert sha(app/'package-lock.json')==proof['lockHash'],'LOCKFILE_CHANGED'
    assert sha(modules/'.package-lock.json')==proof['installedLockHash'],'INSTALLED_LOCK_CHANGED'
    lock=json.loads((app/'package-lock.json').read_text())['packages'];installed=json.loads((modules/'.package-lock.json').read_text())['packages']
    for p,v in installed.items():
     if p not in lock or any(v.get(k)!=lock[p].get(k) for k in ('version','integrity')):bad.append('PACKAGE_LOCK_MISMATCH:'+p)
    for p,v in lock.items():
     if p and not v.get('optional') and p not in installed:bad.append('REQUIRED_PACKAGE_MISSING:'+p)
    print(json.dumps({'root':str(root),'dependencyFilesChecked':len(proof['files']),'missingOrChanged':len(bad),'examples':bad[:8],'viteEntryExists':(modules/'vite/dist/node/cli.js').is_file()}))
    if bad:return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
