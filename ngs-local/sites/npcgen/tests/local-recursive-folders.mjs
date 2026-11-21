import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('MCP file DTO advances one bounded chunk per pull and rejects incorrect lineage or lengths',async()=>{
 const bytes=Buffer.alloc(2*1024*1024+13,3),scope='binari/npcs',path='test.dat',sha256=digest(bytes),calls=[];
 let revoked=false;
 const file=createFolderMcpClient({call:async(name,args)=>{
  assert.equal(name,'npc_folder_file_chunk');
  calls.push(args.offset);
  const content=bytes.subarray(args.offset,args.offset+1024*1024),after=args.offset+content.length;
  return {...args,path:revoked?'wrong.dat':path,size:bytes.length,base64:content.toString('base64'),
   nextOffset:after===bytes.length?null:after};
 }});
 const token=file.file(scope,path,sha256,bytes.length);
 assert.equal(token.headers.get('content-length'),String(bytes.length));
 assert.deepEqual(calls,[]);
 const reader=token.body.getReader();
 assert.equal((await reader.read()).value.length,1024*1024);
 assert.deepEqual(calls,[0]);
 assert.equal((await reader.read()).value.length,1024*1024);
 assert.equal((await reader.read()).value.length,13);
 assert.equal((await reader.read()).done,true);
 assert.deepEqual(calls,[0,1024*1024,2*1024*1024]);
 revoked=true;
 await assert.rejects(file.file(scope,path,sha256,bytes.length).body.getReader().read(),/FOLDER_MCP_UNAVAILABLE/);
});
