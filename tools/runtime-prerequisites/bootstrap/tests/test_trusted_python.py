"""Synthetic tar fixtures only; never download or execute Python payloads."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import prepare_trusted_python as setup


class TrustedPython(unittest.TestCase):
    def test_malformed_manifest_cannot_change_pins_or_limits(self):
        original = setup.load_manifest()
        changes = [('url', 'https://example.com/archive.tar.gz'),
                   ('sha256', '0'*64), ('archiveRoot', '..'),
                   ('interpreter', '/tmp/python'), ('licenseFile', '../LICENSE'),
                   ('maxArchiveBytes', True), ('maxExpandedBytes', 1073741825),
                   ('maxMembers', 0), ('maxMembers', 1.5)]
        with tempfile.TemporaryDirectory(dir=Path.home()) as tmp:
            path = Path(tmp)/'manifest.json'
            for key, value in changes:
                with self.subTest(key=key, value=value):
                    path.write_text(json.dumps({**original, key: value}))
                    with patch.object(setup, 'MANIFEST', path), self.assertRaises(ValueError):
                        setup.load_manifest()

    def archive(self, base, extra=None):
        archive=base/'fixture.tar.gz'
        with tarfile.open(archive,'w:gz') as tar:
            # Real install_only archives omit uv's installed-tree BUILD marker.
            for name,data,mode in [('python/bin/python3.12',b'inert fixture, never execute\n',0o755),('python/lib/python3.12/LICENSE.txt',b'fixture license',0o644)]:
                info=tarfile.TarInfo(name);info.size=len(data);info.mode=mode;tar.addfile(info,io.BytesIO(data))
            link=tarfile.TarInfo('python/bin/python3');link.type=tarfile.SYMTYPE;link.linkname='python3.12';tar.addfile(link)
            if extra:
                tar.addfile(extra,io.BytesIO(b'x') if extra.size else None)
        manifest=setup.load_manifest();manifest['sha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
        return archive,manifest
    def test_new_private_archive_no_execution_and_no_retry(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as tmp:
            base=Path(tmp);archive,manifest=self.archive(base);root=base/'runtime'
            with patch.object(setup,'load_manifest',return_value=manifest),patch.object(setup.platform,'system',return_value='Darwin'),patch.object(setup.platform,'machine',return_value='arm64'),patch.object(setup,'download',side_effect=AssertionError('network forbidden')):
                plan=setup.prepare(root=root,archive=archive)
                self.assertEqual(plan['state'],'plan-only');self.assertFalse(root.exists())
                result=setup.prepare(root=root,archive=archive,apply=True)
                self.assertEqual(result['state'],'python-prepared-not-activated')
                self.assertEqual((root/'python/bin/python3').resolve(),root/'python/bin/python3.12')
                self.assertEqual((root/'python/bin/python3.12').stat().st_mode&0o777,0o700)
                self.assertTrue(archive.exists());self.assertFalse(result['runsInterpreter'])
                self.assertFalse((root/'python/BUILD').exists())
                self.assertEqual(result['buildAuthority'],'pinned-official-archive-sha256')
                with self.assertRaises(ValueError):setup.prepare(root=root,archive=archive,apply=True)
    def test_hash_failure_before_extraction_and_intent_preserved(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as tmp:
            base=Path(tmp);archive,manifest=self.archive(base);manifest['sha256']='0'*64
            with patch.object(setup,'load_manifest',return_value=manifest),patch.object(setup.platform,'system',return_value='Darwin'),patch.object(setup.platform,'machine',return_value='arm64'),patch.object(setup,'extract_verified',side_effect=AssertionError('must not extract')):
                with self.assertRaisesRegex(ValueError,'HASH_MISMATCH'):setup.prepare(root=base/'runtime',archive=archive,apply=True)
                self.assertFalse((base/'runtime').exists());self.assertTrue((base/'runtime.python-setup-intent.json').exists())
                self.assertTrue(list(base.glob('.python-setup-*/verified.tar.gz')))
    def test_traversal_links_special_files_denied(self):
        for kind in ('traversal','escape','device','hardlink'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory(dir=Path.home()) as tmp:
                base=Path(tmp);entry=tarfile.TarInfo('python/bad')
                if kind=='traversal':entry.name='python/../../outside';entry.size=1
                if kind=='escape':entry.type=tarfile.SYMTYPE;entry.linkname='../../outside'
                if kind=='device':entry.type=tarfile.CHRTYPE
                if kind=='hardlink':entry.type=tarfile.LNKTYPE;entry.linkname='python/bin/python3.12'
                archive,manifest=self.archive(base,entry)
                with self.assertRaises(ValueError):setup.extract_verified(archive,base/'out',manifest)
                self.assertFalse((base/'outside').exists())

if __name__=='__main__':unittest.main()
