import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectFolders} from '../build/local-project-folders.mjs';

const icon=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=','base64');
const hash=createHash('sha256').update(icon).digest('hex');
const setup=t=>{const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-project-folders-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
};
test('replica metadata remains read-only and digest-bound; unapproved roots are not exposed',t=>{
 const root=setup(t);
 for(const id of ['binari','unapproved']){
  mkdirSync(join(root,id),{mode:0o700});
  writeFileSync(join(root,id,'project.json'),JSON.stringify({name:'비나리'}),{mode:0o600});
 }
 writeFileSync(join(root,'binari','icon.png'),icon,{mode:0o600});
 const store=createLocalProjectFolders({root});
 assert.deepEqual(Object.keys(store),['list','icon']);
 assert.deepEqual(store.list(id=>id==='binari'),[{
  projectId:'binari',name:'비나리',needsRefresh:false,iconUrl:'/api/project-folders/icon?projectId=binari&sha256='+hash,
 }]);
 assert.deepEqual(store.icon('binari',hash),icon);
 assert.equal(store.icon('binari','0'.repeat(64)),null);
});
test('symlinked project folders cannot republish outside replica files',t=>{
 const root=setup(t);
 const actual=join(root,'.elsewhere');mkdirSync(actual,{mode:0o700});
 writeFileSync(join(actual,'project.json'),'{"name":"do not expose"}',{mode:0o600});
 symlinkSync(actual,join(root,'binari'));
 const store=createLocalProjectFolders({root});
 assert.throws(()=>store.list(()=>true),/PROJECT_FOLDERS_UNAVAILABLE/);
});
