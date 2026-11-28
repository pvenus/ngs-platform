import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {chmodSync,existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assertMirrorWslFilesystem,mirrorChunkBytes,mirrorRuntime,openMirror,replicaPathResource,validateMirrorManifest} from '../lib/mirror.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const row=(path,value)=>({path,sha256:sha(value),size:Buffer.byteLength(value)});
const manifest=(files,resources)=>({projectId:'binari',files,...(resources?{resources}:{})});
const file=(mirror,path)=>join(mirror.projectRoot,path);
const same=(code)=>e=>e?.message===code;
const windows=process.platform==='win32';
function fixture(t){
 const dir=mkdtempSync(join(realpathSync.native(tmpdir()),'ngs-mirror-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return windows?join(dir,'private P2'):dir;
}
async function using(t){
 const dir=fixture(t), mirror=await openMirror(dir,{create:windows});
 t.after(()=>mirror.close());
 return {dir,mirror};
}
function sync(m,path,val,resources=['npcs']){
 const b=m.begin(manifest([row(path,val)],resources));
 if(b.files.length&&Buffer.byteLength(val)>0)m.append(b.syncId,path,0,Buffer.from(val));
 return m.finish(b.syncId);
}
test('verifies staged incremental hash; current is unavailable until complete, then resumes from disk',async t=>{
 const {dir,mirror:m}=await using(t), p='npcs/npc.test/body.png';
 const data=Buffer.alloc(mirrorChunkBytes+17,47), fileRow=row(p,data);
 const b=m.begin(manifest([fileRow],['npcs']));
 assert.deepEqual(b.files,[fileRow]);assert.equal(m.snapshot(),null);
 assert.throws(()=>m.begin(manifest([],['npcs'])),same('VIEWER_MIRROR_SYNC_IN_PROGRESS'));
 assert.throws(()=>m.append(b.syncId,p,1,data.subarray(0,17)),same('VIEWER_MIRROR_CHUNK_OFFSET'));
 assert.throws(()=>m.append(b.syncId,p,0,data),same('VIEWER_MIRROR_BAD_CHUNK'));
 assert.deepEqual(m.append(b.syncId,p,0,data.subarray(0,mirrorChunkBytes)),{offset:mirrorChunkBytes});
 assert.throws(()=>m.append(b.syncId,p,0,data.subarray(0,1)),same('VIEWER_MIRROR_CHUNK_OFFSET'));
 assert.throws(()=>m.finish(b.syncId),same('VIEWER_MIRROR_TRANSFER_INCOMPLETE'));
 assert.equal(existsSync(file(m,p)),false);
 m.append(b.syncId,p,mirrorChunkBytes,data.subarray(mirrorChunkBytes));
 assert.equal(existsSync(file(m,p)),false);
 assert.deepEqual(m.finish(b.syncId),{files:1,changed:1,removed:0});
 assert.deepEqual(readFileSync(file(m,p)),data);
 await assert.rejects(openMirror(dir),same('VIEWER_P2_ALREADY_OPEN'));
 m.close();
 const re=await openMirror(dir);t.after(()=>re.close());
 const b2=re.begin(manifest([fileRow],['npcs']));
 assert.deepEqual(b2.files,[]);
 assert.deepEqual(re.finish(b2.syncId),{files:1,changed:0,removed:0});
 assert.deepEqual(re.snapshot(),manifest([fileRow],['npcs']));
});

test('wrong content or incomplete second file leaves previous files and manifest untouched',async t=>{
 const {mirror:m}=await using(t), p='npcs/body', q='npcs/extra';
 sync(m,p,'source');
 const prior=m.snapshot();
 const b=m.begin(manifest([row(p,'target'),row(q,'new')],['npcs']));
 assert.throws(()=>m.append(b.syncId,p,0,Buffer.from('wrong!')),same('VIEWER_MIRROR_HASH_MISMATCH'));
 assert.throws(()=>m.finish(b.syncId),same('VIEWER_MIRROR_TRANSFER_INCOMPLETE'));
 m.abort(b.syncId);
 const b2=m.begin(manifest([row(p,'target'),row(q,'new')],['npcs']));
 m.append(b2.syncId,p,0,Buffer.from('target'));
 assert.throws(()=>m.finish(b2.syncId),same('VIEWER_MIRROR_TRANSFER_INCOMPLETE'));
 m.abort(b2.syncId);
 assert.equal(readFileSync(file(m,p),'utf8'),'source');assert.equal(existsSync(file(m,q)),false);
 assert.deepEqual(m.snapshot(),prior);
});
test('validates complete permission coverage; preserves revoked paths, unknown files, and local edits',async t=>{
 const {mirror:m}=await using(t), old='npcs/old', removed='npcs/removed', modified='npcs/modified';
 const rows=[old,removed,modified].map(p=>row(p,'source'));
 const initial=m.begin(manifest(rows,['npcs']));
 for(const x of rows)m.append(initial.syncId,x.path,0,Buffer.from('source'));
 m.finish(initial.syncId);
 writeFileSync(file(m,modified),'local-only');
 const unknown='npcs/user-file';writeFileSync(file(m,unknown),'do not touch',{mode:0o600});
 // Uncovered manifest is not proof that an NPC file was deleted.
 const denied=m.begin(manifest([],['project']));m.finish(denied.syncId);
 assert.equal(existsSync(file(m,old)),true);assert.deepEqual(m.snapshot().files,[]);
 const now=m.begin(manifest([row(old,'source')],['npcs']));
 assert.deepEqual(m.finish(now.syncId),{files:1,changed:0,removed:1});
 assert.equal(existsSync(file(m,removed)),false);
 assert.equal(readFileSync(file(m,modified),'utf8'),'local-only');
 assert.equal(readFileSync(file(m,unknown),'utf8'),'do not touch');
 assert.throws(()=>m.begin(manifest([row(unknown,'new')],['npcs'])),same('VIEWER_P2_UNKNOWN_FILE'));
 writeFileSync(file(m,old),'modified');
 assert.throws(()=>m.begin(manifest([row(old,'new')],['npcs'])),same('VIEWER_P2_LOCALLY_EDITED_FILE'));
});
test('validates canonical scope paths, nested aliases, and empty blobs',async t=>{
 const {mirror:m}=await using(t);
 assert.equal(replicaPathResource('cinematics/assemblies/map.json'),'assembly');
 assert.equal(replicaPathResource('motion-presets/run.json'),'motion-presets');
 for(const unsafe of ['../../credentials','npcs/.credentials','oops/credential','npcs/a\\b','npcs//a','project/fake']){
  assert.throws(()=>validateMirrorManifest(manifest([row(unsafe,'x')])),same('VIEWER_MIRROR_BAD_FILE'));
 }
 assert.throws(()=>validateMirrorManifest(manifest([row('npcs/Foo/a','x'),row('npcs/foo/b','x')])),same('VIEWER_MIRROR_LOCAL_PATH_ALIAS'));
 assert.throws(()=>validateMirrorManifest(manifest([row('npcs/foo','x'),row('npcs/foo/bar','y')])),same('VIEWER_MIRROR_FILE_IS_PARENT'));
 assert.throws(()=>m.begin(manifest([row('npcs/b','x')],['project'])),same('VIEWER_MIRROR_FILE_OUTSIDE_GRANT'));
 const p='npcs/empty';
 assert.deepEqual(sync(m,p,''),{files:1,changed:1,removed:0});
 assert.equal(readFileSync(file(m,p)).length,0);
});
test('POSIX rejects unmanaged folders and traversal through links or permissive directories',{skip:windows},async t=>{
 const dir=fixture(t);mkdirSync(join(dir,'binari'),{mode:0o700});
 writeFileSync(join(dir,'binari','stay'),'leave');
 await assert.rejects(openMirror(dir),same('VIEWER_P2_UNMANAGED_BINARI'));
 assert.equal(readFileSync(join(dir,'binari','stay'),'utf8'),'leave');
 const {mirror:m}=await using(t), other=fixture(t);
 symlinkSync(other,file(m,'npcs'),'dir');
 assert.throws(()=>m.begin(manifest([row('npcs/f','x')],['npcs'])),same('VIEWER_P2_UNSAFE_DIRECTORY'));
 rmSync(file(m,'npcs'));
 mkdirSync(file(m,'npcs'),{mode:0o755});
 assert.throws(()=>m.begin(manifest([row('npcs/f','x')],['npcs'])),same('VIEWER_P2_UNSAFE_DIRECTORY'));
 chmodSync(file(m,'npcs'),0o700);
 writeFileSync(join(other,'keep'),'do not touch',{mode:0o600});linkSync(join(other,'keep'),file(m,'npcs/f'));
 assert.throws(()=>m.begin(manifest([row('npcs/f','x')],['npcs'])),same('VIEWER_P2_UNSAFE_FILE'));
 assert.equal(readFileSync(join(other,'keep'),'utf8'),'do not touch');
});
test('finalize rechecks current fingerprints and leaves new remote data uncommitted on local write',async t=>{
 const {mirror:m}=await using(t), p='npcs/old';
 sync(m,p,'original');
 const b=m.begin(manifest([row(p,'remote')],['npcs']));
 m.append(b.syncId,p,0,Buffer.from('remote'));
 writeFileSync(file(m,p),'local edit');
 assert.throws(()=>m.finish(b.syncId),same('VIEWER_P2_FILE_CHANGED'));
 m.abort(b.syncId);
 assert.equal(readFileSync(file(m,p),'utf8'),'local edit');
});
test('restores an interrupted multi-file publish journal and removes abandoned staging',async t=>{
 const dir=fixture(t), m=await openMirror(dir,{create:windows}), p='npcs/old', q='npcs/new';
 sync(m,p,'original');
 const state=m.snapshot();m.close();
 const id=randomUUID(), base=join(dir,'.ngs-viewer'), stage=join(base,'sync-'+id);
 mkdirSync(stage,{mode:0o700});
 writeFileSync(join(stage,'backup-0'),'original',{mode:0o600});
 writeFileSync(join(dir,'binari',p),'remote',{mode:0o600});
 writeFileSync(join(dir,'binari',q),'another',{mode:0o600});
 writeFileSync(join(stage,'commit.json'),JSON.stringify({id,ops:[
  {path:p,old:sha('original'),next:sha('remote')},
  {path:q,old:null,next:sha('another')}
 ]}),{mode:0o600});
 const abandoned=join(base,'sync-'+randomUUID());mkdirSync(abandoned,{mode:0o700});
 const newer=await openMirror(dir);t.after(()=>newer.close());
 assert.deepEqual(newer.snapshot(),state);assert.equal(readFileSync(file(newer,p),'utf8'),'original');
 assert.equal(existsSync(file(newer,q)),false);assert.equal(existsSync(stage),false);
 assert.equal(existsSync(abandoned),false);
});

test('native Windows uses a distinct NTFS guard; WSL2 development still needs a native Linux volume',()=>{
 const classify=(platform,kernel,userId=501,wslEnvironment=false)=>mirrorRuntime({platform,kernel,userId,wslEnvironment});
 assert.equal(classify('win32','10.0.26100'),'ntfs');
 assert.throws(()=>classify('linux','4.4.0-19041-Microsoft'),same('VIEWER_P2_REQUIRES_WSL2_LINUX_FILESYSTEM'));
 assert.throws(()=>classify('linux','5.15.167.4-microsoft-standard-WSL2',0),same('VIEWER_P2_REQUIRES_WSL2_LINUX_FILESYSTEM'));
 assert.throws(()=>classify('linux','6.0.0',501,true),same('VIEWER_P2_REQUIRES_WSL2_LINUX_FILESYSTEM'));
 assert.equal(classify('linux','5.15.167.4-microsoft-standard-WSL2'),'wsl2');
 assert.equal(classify('linux','4.19.128-microsoft-standard'),'wsl2');
 assert.equal(classify('linux','6.8.0'),'posix');
 assert.equal(classify('darwin','25.2.0'),'posix');
 assert.doesNotThrow(()=>assertMirrorWslFilesystem(0xef53));
 for(const type of [0x01021997,0x5346544e,0xff534d42,0x65735546]){
  assert.throws(()=>assertMirrorWslFilesystem(type),same('VIEWER_P2_REQUIRES_WSL2_LINUX_FILESYSTEM'));
 }
});
