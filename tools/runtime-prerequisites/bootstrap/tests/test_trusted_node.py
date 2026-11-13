"""Inert xz fixtures: no real Node, package installs or network."""
import hashlib,io,json,sys,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import prepare_trusted_node as setup

class TrustedNode(unittest.TestCase):
    def fixture(self,base):
        m=setup.load_manifest();p=base/'node.tar.xz'
        with tarfile.open(p,'w:xz') as tar:
            for relative in m['filePins']:
                raw=(json.dumps({'version':'11.19.0'}).encode() if relative.endswith('package.json') else b'inert fixture')
                member=tarfile.TarInfo(m['archiveRoot']+'/'+relative);member.size=len(raw);member.mode=0o755 if relative=='bin/node' else 0o644
                tar.addfile(member,io.BytesIO(raw));m['filePins'][relative]=hashlib.sha256(raw).hexdigest()
            member=tarfile.TarInfo(m['npmBin']);member.type=tarfile.SYMTYPE;member.linkname='../lib/node_modules/npm/bin/npm-cli.js';tar.addfile(member)
        m['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();return p,m
    def test_plan_apply_xz_and_nooverwrite(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as t:
            base=Path(t);archive,m=self.fixture(base);root=base/'new'
            with patch.object(setup,'load_manifest',return_value=m),patch.object(setup.platform,'system',return_value='Darwin'),patch.object(setup.platform,'machine',return_value='arm64'),patch.object(setup,'download',side_effect=AssertionError('no network')):
                plan=setup.prepare(root=root,archive=archive);self.assertFalse(root.exists());self.assertFalse(plan['runsTool'])
                result=setup.prepare(root=root,archive=archive,apply=True)
                self.assertEqual(result['state'],'node-prepared-not-activated')
                self.assertEqual(Path(result['npmBin']).resolve(),Path(result['npmCli']))
                self.assertTrue((root/m['archiveRoot']/'LICENSE').is_file())
                with self.assertRaises(ValueError):setup.prepare(root=root,archive=archive,apply=True)
    def test_pin_and_bool_limit_rejected(self):
        original=setup.load_manifest()
        with tempfile.TemporaryDirectory(dir=Path.home()) as t:
            p=Path(t)/'lock.json'
            for k,v in [('url','https://example.com'),('sha256','0'*64),('npmCli','/bad'),('filePins',{}),('maxMembers',True)]:
                p.write_text(json.dumps({**original,k:v}))
                with patch.object(setup,'MANIFEST',p),self.assertRaises(ValueError):setup.load_manifest()
    def test_hash_before_extract_and_node_redirect(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as t:
            base=Path(t);archive,m=self.fixture(base);m['sha256']='0'*64
            with patch.object(setup,'load_manifest',return_value=m),patch.object(setup.platform,'system',return_value='Darwin'),patch.object(setup.platform,'machine',return_value='arm64'),patch.object(setup,'extract_verified',side_effect=AssertionError('no parse')):
                with self.assertRaisesRegex(ValueError,'HASH_MISMATCH'):setup.prepare(root=base/'new',archive=archive,apply=True)
        with self.assertRaisesRegex(ValueError,'REDIRECT_DENIED'):
            setup.NodeRedirect().redirect_request(None,None,302,'',{},'https://example.com/evil')

if __name__=='__main__':unittest.main()
