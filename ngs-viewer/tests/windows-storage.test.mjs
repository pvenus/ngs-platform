import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,symlinkSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openMirror} from '../lib/mirror.mjs';
import {ntfsGuardScript,verifyNtfsRoot,windowsFileSegment,windowsP2Path} from '../lib/windows-storage.mjs';
const p=String.raw`D:\Workspace\비나리 P2`;
test('native exposes only canonical local drive paths and excludes reserved Win32 aliases',()=>{
 assert.equal(windowsP2Path(p),true);
 for(const name of ['COM¹','LPT0:secret','NUL.txt','CON','AUX.zip','PRN','lpt9.json','name.','name ','foo:NTFS-stream','a?b'])
  assert.equal(windowsFileSegment(name),false,name);
 for(const dir of [String.raw`\\server\ngs\P2`,String.raw`\\?\C:\NGS\P2`,String.raw`C:\foo\..\P2`,'C:/P2','C:P2','C:\\'])
  assert.equal(windowsP2Path(dir),false,dir);
});
test('Windows helper uses ACLs, does not recurse through any NTFS reparse point and fails closed',()=>{
 const script=ntfsGuardScript(p,{deep:true,create:true});
 assert.match(script,/Get-Attributes \$child[\s\S]+if \(\$dir\) \{ \$queue\.Push\(\$child\)/u);
 assert.match(script,/FileAttributes\]::ReparsePoint/u);
 assert.match(script,/SetAccessRuleProtection\(\$true,\$false\)/u);
 assert.match(script,/\$acl\.GetOwner|\$acl\.GetAccessRules/u);
 assert.match(script,/DriveFormat -ne 'NTFS'/u);
 verifyNtfsRoot(p,{create:true},(exe,args,opts)=>{
  assert.match(exe,/\\powershell\.exe$/iu);assert.equal(opts.windowsHide,true);
  assert.match(Buffer.from(args.at(-1),'base64').toString('utf16le'),/Test-PrivateAcl/u);
  return 'OK\r\n';
 });
 assert.throws(()=>verifyNtfsRoot(p,{deep:true},()=>{throw Object.assign(Error(),{stdout:'VIEWER_P2_REPARSE_POINT\r\n'});}),/VIEWER_P2_REPARSE_POINT/u);
 assert.throws(()=>verifyNtfsRoot(p,{},()=> 'something else'),/VIEWER_P2_NTFS_CHECK_FAILED/u);
});

test('Windows integration: creates private P2 and rejects a nested NTFS directory junction', {skip:process.platform!=='win32'}, async t=>{
 const temp=mkdtempSync(join(realpathSync.native(tmpdir()),'ngs-viewer-ntfs-it-'));
 t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const root=join(temp,'개인 P2');
 const mirror=await openMirror(root,{create:true});
 try{
  assert.deepEqual(mirror.inventory(),[]);
  assert.match(mirror.privateSpoolRoot(),/\.ngs-viewer$/u);
  const pass=mirror.begin({projectId:'binari',resources:['project'],files:[]});
  assert.equal(mirror.finish(pass.syncId).files,0);
 }finally{mirror.close();}
 symlinkSync(temp,join(root,'nested junction'),'junction');
 await assert.rejects(openMirror(root),/VIEWER_P2_REPARSE_POINT/u);
});

test('Windows integration: rejects an existing unprotected P2 and preserves its contents', {skip:process.platform!=='win32'}, async t=>{
 const temp=mkdtempSync(join(realpathSync.native(tmpdir()),'ngs-viewer-ntfs-inherited-it-'));
 t.after(()=>rmSync(temp,{recursive:true,force:true}));
 writeFileSync(join(temp,'keep.txt'),'untouched');
 await assert.rejects(openMirror(temp,{create:true}),/VIEWER_P2_NTFS_ACL_UNSAFE/u);
});
