import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {workspaceTabs} from '../build/project-workspace-view.mjs';
import {workspaceReadResource,workspaceReadRegistry,dispatchWorkspaceRead} from '../build/workspace-read-registry.mjs';

test('every shared workspace has an existing resource scope and no platform-specific storage dependencies',async()=>{
 assert.equal(workspaceReadResource('unregistered-content'),null);
 for(const tab of workspaceTabs)assert.ok(workspaceReadResource(tab),'missing scope for '+tab);
 const hit=new Set(),dir=new URL('../build/',import.meta.url);
 function verify(url){
  if(hit.has(url.href))return;
  hit.add(url.href);
  const source=readFileSync(url,'utf8');
  assert.doesNotMatch(source,/\b(?:R2Bucket|D1Database|BUCKET)\b/,url.href);
  for(const [,specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)){
   const target=new URL(specifier,url);
   assert.ok(specifier.startsWith('./')&&target.href.startsWith(dir.href),url.href+' -> '+specifier);
   verify(target);
  }
 }
 verify(new URL('workspace-read-registry.mjs',dir));
 assert.ok(hit.has(new URL('npc-workspace.mjs',dir).href));
 for(const pathname of Object.keys(workspaceReadRegistry)){
  assert.notEqual(await dispatchWorkspaceRead({pathname,query:new URLSearchParams('projectId=binari&tab=concept'),
   authorize(){throw Object.assign(Error('fixture'),{status:403});},openProject(){assert.fail('storage precedes auth');}}).then(()=>null,e=>e.status),null);
 }
});
