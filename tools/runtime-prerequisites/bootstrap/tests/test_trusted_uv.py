"""Tiny inert uv fixtures only. No real tool execution/download."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepare_trusted_uv as setup

class TrustedUv(unittest.TestCase):
    def fixture(self, base, bad=None):
        p=base/'uv.tar.gz';manifest=setup.load_manifest()
        with tarfile.open(p,'w:gz') as tar:
            directory=tarfile.TarInfo(manifest['archiveRoot']);directory.type=tarfile.DIRTYPE;tar.addfile(directory)
            for name in manifest['executables'].values():
                member=tarfile.TarInfo(name);data=b'not executable fixture';member.size=len(data);member.mode=0o755
                tar.addfile(member,io.BytesIO(data))
            if bad:tar.addfile(bad)
        manifest['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
        return p,manifest
    def test_plan_apply_notices_no_overwrite(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as t:
            base=Path(t);archive,m=self.fixture(base);root=base/'new'
            with patch.object(setup,'load_manifest',return_value=m),patch.object(setup.platform,'system',return_value='Darwin'),patch.object(setup.platform,'machine',return_value='arm64'),patch.object(setup.archive_tools,'download',side_effect=AssertionError('no network')):
                result=setup.prepare(root=root,archive=archive)
                self.assertEqual(result['state'],'plan-only');self.assertFalse(root.exists())
                result=setup.prepare(root=root,archive=archive,apply=True)
                self.assertEqual(result['state'],'uv-prepared-not-activated');self.assertFalse(result['runsTool'])
                for name,notice in m['notices'].items():
                    self.assertEqual((root/'notices'/name).read_bytes(),setup.notice_bytes(name,m))
                with self.assertRaises(ValueError):setup.prepare(root=root,archive=archive,apply=True)
    def test_malformed_pin_notice_or_limit(self):
        original=setup.load_manifest()
        with tempfile.TemporaryDirectory(dir=Path.home()) as t:
            p=Path(t)/'lock.json'
            for key,value in [('url','https://example.com'),('sha256','0'*64),('archiveRoot','..'),('licenseFiles',[]),('notices',{}),('maxMembers',True),('maxArchiveBytes',0)]:
                with self.subTest(key=key):
                    p.write_text(json.dumps({**original,key:value}))
                    with patch.object(setup,'MANIFEST',p),self.assertRaises(ValueError):setup.load_manifest()
    def test_tar_boundary_and_hash_before_extract(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as t:
            base=Path(t);bad=tarfile.TarInfo('uv-aarch64-apple-darwin/escape');bad.type=tarfile.SYMTYPE;bad.linkname='../../outside'
            archive,m=self.fixture(base,bad)
            with self.assertRaises(ValueError):setup.extract_verified(archive,base/'payload',m)
            m['sha256']='0'*64
            with patch.object(setup,'load_manifest',return_value=m),patch.object(setup.platform,'system',return_value='Darwin'),patch.object(setup.platform,'machine',return_value='arm64'),patch.object(setup,'extract_verified',side_effect=AssertionError('must not parse archive')):
                with self.assertRaisesRegex(ValueError,'HASH_MISMATCH'):setup.prepare(root=base/'new',archive=archive,apply=True)

if __name__=='__main__':unittest.main()
