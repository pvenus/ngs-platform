"""Prepare pinned private Node/npm files, never run installers or modify global Node."""
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
import urllib.parse
import urllib.request

import archive_common as safe
import prepare_trusted_python as archive_tools

MANIFEST = Path(__file__).resolve().with_name('trusted-node.lock.json')
ROOT = 'node-v24.21.0-darwin-arm64'
URL = 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.xz'
SHA256 = '6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe'
PINS = {
 'bin/node': 'e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b',
 'lib/node_modules/npm/bin/npm-cli.js': '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7',
 'LICENSE': '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace',
 'lib/node_modules/npm/LICENSE': '7610d223851f421d315df5e77974f1c68a04b97e02060e5bbbcf13d95e3ca257',
 'lib/node_modules/npm/package.json': '09dfcf187178ce1ab3ea6194c80d3ae082ad2a86dc1269ac963f94429e718122'}


def load_manifest():
    m = json.loads(MANIFEST.read_text(), object_pairs_hook=safe.unique)
    expected = dict(schemaVersion='ngs.trusted-node.v1', version='24.21.0', npmVersion='11.19.0',
                    platform='darwin', architecture='arm64', url=URL, sha256=SHA256,
                    archiveRoot=ROOT, node=ROOT+'/bin/node', npmCli=ROOT+'/lib/node_modules/npm/bin/npm-cli.js',
                    npmBin=ROOT+'/bin/npm', filePins=PINS)
    if any(m.get(k) != v for k,v in expected.items()): raise ValueError('NODE_MANIFEST_PIN_MISMATCH')
    for key, maximum in {'maxArchiveBytes':67108864,'maxExpandedBytes':536870912,'maxMembers':10000}.items():
        if type(m.get(key)) is not int or not 1 <= m[key] <= maximum:
            raise ValueError('NODE_MANIFEST_LIMIT_INVALID')
    return m


class NodeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlsplit(newurl)
        if u.scheme != 'https' or u.hostname != 'nodejs.org' or u.port not in (None,443) or u.username or u.password:
            raise ValueError('NODE_REDIRECT_DENIED')
        return super().redirect_request(req,fp,code,msg,headers,newurl)


def download(path, m):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NodeRedirect())
    with opener.open(urllib.request.Request(URL,headers={'User-Agent':'NGS-private-Node-setup/1'}),timeout=60) as response, path.open('xb') as stream:
        if response.status != 200:raise ValueError('NODE_DOWNLOAD_STATUS')
        count=0
        while True:
            data=response.read(1024*1024)
            if not data:break
            count+=len(data)
            if count>m['maxArchiveBytes']:raise ValueError('NODE_ARCHIVE_TOO_LARGE')
            stream.write(data)
        stream.flush();os.fsync(stream.fileno())


def extract_verified(archive, destination, m):
    archive_tools.extract_archive(archive,destination,m)
    for relative,digest in m['filePins'].items():
        p=destination/m['archiveRoot']/relative
        if p.is_symlink() or not p.is_file():raise ValueError('NODE_REQUIRED_FILE_INVALID')
        h=hashlib.sha256()
        with p.open('rb') as stream:
            for data in iter(lambda:stream.read(1024*1024),b''):h.update(data)
        if h.hexdigest()!=digest:raise ValueError('NODE_REQUIRED_FILE_HASH')
    node,npm_cli,npm_bin=(destination/m[k] for k in ('node','npmCli','npmBin'))
    if not os.access(node,os.X_OK) or npm_bin.resolve(strict=True)!=npm_cli:
        raise ValueError('NODE_EXECUTABLE_LAYOUT')
    metadata=json.loads((destination/m['archiveRoot']/'lib/node_modules/npm/package.json').read_text())
    if metadata.get('version')!=m['npmVersion']:raise ValueError('NODE_NPM_VERSION')


def prepare(*,root,archive=None,download_requested=False,apply=False):
    m=load_manifest();root=archive_tools.private_destination(root)
    if platform.system()!='Darwin' or platform.machine()!='arm64':raise ValueError('NODE_MAC_ARM64_REQUIRED')
    if archive is not None and download_requested:raise ValueError('NODE_ARCHIVE_OR_DOWNLOAD_NOT_BOTH')
    if apply and archive is None and not download_requested:raise ValueError('NODE_EXPLICIT_ARCHIVE_OR_DOWNLOAD_REQUIRED')
    intent=root.with_name(root.name+'.node-setup-intent.json')
    if os.path.lexists(intent):raise ValueError('NODE_INTENT_EXISTS_INSPECT_NO_RETRY')
    result=dict(schemaVersion='ngs.trusted-node-preparation.v1',state='plan-only',root=str(root),
                node=str(root/m['node']),npmCli=str(root/m['npmCli']),npmBin=str(root/m['npmBin']),
                version=m['version'],npmVersion=m['npmVersion'],archiveSha256=m['sha256'],
                downloadUrl=URL,modifiesGlobalPaths=False,changesBindings=False,downloadsModels=False,
                runsTool=False,installsPackages=False,activationReady=False,
                npmInvocation=[str(root/m['node']),str(root/m['npmCli'])])
    if not apply and not download_requested:return result
    archive_tools.write_new(intent,{**result,'state':'started-no-auto-retry'})
    stage=Path(tempfile.mkdtemp(prefix='.node-setup-',dir=root.parent));stage.chmod(0o700)
    try:
        original=stage/'download.tar.xz'
        if download_requested:download(original,m)
        else:original=Path(archive).expanduser()
        snapshot=stage/'verified.tar.xz';archive_tools.verified_copy(original,snapshot,m)
        payload=stage/'payload';extract_verified(snapshot,payload,m)
        result['state']='node-prepared-not-activated'
        archive_tools.write_new(payload/'NODE-PREPARATION.json',{**result,'manifest':m})
        safe.install_absent(payload,root);return result
    finally:shutil.rmtree(stage)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',required=True);p.add_argument('--archive')
    p.add_argument('--download',action='store_true',dest='download_requested');p.add_argument('--apply',action='store_true')
    try:print(json.dumps(prepare(**vars(p.parse_args())),indent=2));return 0
    except (OSError,ValueError,tarfile.TarError) as exc:print(json.dumps({'state':'blocked','error':str(exc)}));return 2

if __name__=='__main__':sys.exit(main())
