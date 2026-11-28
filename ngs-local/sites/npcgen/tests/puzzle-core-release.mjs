import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {puzzleCoreVersion,puzzleCoreFiles} from '../build/puzzle-core-bundle.mjs';
import {servePuzzleCore,withPuzzleCore} from '../build/puzzle-core-release.mjs';

test('every published browser runtime file matches its immutable bundle manifest',async()=>{
 const files=Object.entries(puzzleCoreFiles);
 const index=JSON.stringify({schemaVersion:'ngs.puzzle-core-pack.v1',files:files.map(([name,[sha256]])=>({name,sha256}))})+'\n';
 assert.equal(createHash('sha256').update(index).digest('hex'),puzzleCoreVersion);
 assert.match(withPuzzleCore('<html lang="ko">'),new RegExp(puzzleCoreVersion));
 assert.ok(files.some(([name])=>name.endsWith('.wasm')));
 const prefix='/puzzle-core/'+puzzleCoreVersion+'/_framework/';
 for(const [name,[sha,size]] of files){
  const head=await servePuzzleCore(prefix+name,'HEAD');
  assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),String(size));
  const member=await servePuzzleCore(prefix+name,'GET'),body=Buffer.from(await member.arrayBuffer());
  assert.equal(body.length,size);assert.equal(createHash('sha256').update(body).digest('hex'),sha);
 }
 assert.equal(await servePuzzleCore(prefix+'../dotnet.js','GET'),null);
 assert.equal(await servePuzzleCore(prefix+'dotnet.js','POST'),null);
});
