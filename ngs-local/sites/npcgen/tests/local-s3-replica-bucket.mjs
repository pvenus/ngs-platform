import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chmodSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createS3ReplicaBucket,openLocalS3ReplicaBucket,readLocalS3ReplicaConfig} from '../build/local-s3-replica-bucket.mjs';

const digest='12'.repeat(32);
const impl=Object.fromEntries(['HeadObject','GetObject','PutObject','ListObjectsV2','DeleteObject','DeleteObjects',
 'CreateMultipartUpload','UploadPart','CompleteMultipartUpload','AbortMultipartUpload'].map(name=>
 [name+'Command',class{constructor(input){Object.assign(this,{name,input});}}]));
const precondition=()=>Object.assign(Error('synthetic conditional failure'),{$metadata:{httpStatusCode:412}});
const absent=()=>Object.assign(Error('synthetic missing object'),{$metadata:{httpStatusCode:404}});
const bytes=(...n)=>new Uint8Array(n);
const body=buf=>new Response(buf).body;
function fixture(handler){
 const calls=[];const client={async send(c){calls.push(c);return handler(c.name,c.input);}};
 return {calls,bucket:createS3ReplicaBucket({client,commands:impl,bucketName:'ngs-local'})};
}

test('conditional put/get uses provider conditions and true full size for matched byte range',async()=>{
 const {bucket,calls}=fixture((name,args)=>{
  if(name==='PutObject'){
   assert.equal(args.IfNoneMatch,'*');
   assert.equal(args.ChecksumSHA256,Buffer.from(digest,'hex').toString('base64'));
   if(args.Key==='occupied')throw precondition();
   return {ETag:'"stored"'};
  }
  if(name==='GetObject'){
   assert.equal(args.IfMatch,'"stored"');
   if(args.Key==='mutated')throw precondition();
   assert.equal(args.Range,'bytes=2-4');
   return {ETag:'"stored"',ContentLength:3,ContentRange:'bytes 2-4/6',Metadata:{sha256:digest},Body:body(bytes(3,4,5))};
  }
  assert.equal(name,'HeadObject');
  if(args.Key==='missing')throw absent();
  return {ETag:'"different"',ContentLength:5,Metadata:{sha256:digest}};
 });
 const options={sha256:digest,onlyIf:new Headers({'If-None-Match':'*'}),customMetadata:{sha256:digest}};
 assert.equal(await bucket.put('occupied',bytes(1),options),null);
 assert.equal((await bucket.put('fresh',bytes(1),options)).size,1);
 const item=await bucket.get('fresh',{onlyIf:{etagMatches:'"stored"'},range:{offset:2,length:3}});
 assert.equal(item.size,6);
 assert.deepEqual(new Uint8Array(await item.arrayBuffer()),bytes(3,4,5));
 assert.equal((await bucket.get('mutated',{onlyIf:{etagMatches:'"stored"'}})).body,undefined);
 assert.equal(await bucket.head('missing'),null);
 assert.ok(calls.every(x=>x.input.Bucket==='ngs-local'));
});

test('NPC cache metadata belongs only to private fixed cache slots',async()=>{
 const metadata={sha256:digest,generation:'42',scope:'npc.fixture'};
 const {bucket,calls}=fixture((method,args)=>{
  assert.equal(method,'PutObject');assert.deepEqual(args.Metadata,metadata);
  return {ETag:'"cached"'};
 });
 const ns='ngs-replica/v1/binari/v2/npc-read-cache-v1/';
 await bucket.put(ns+'detail/ab',bytes(1,2),{sha256:digest,customMetadata:metadata});
 await assert.rejects(bucket.put('ngs-replica/v1/binari/files/npcs/metadata.json',bytes(1),{customMetadata:metadata}),/INPUT_INVALID/);
 await assert.rejects(bucket.put(ns+'detail/ab',bytes(1),{customMetadata:{...metadata,scope:'../private'}}),/INPUT_INVALID/);
 assert.equal(calls.length,1);
});

test('lists exact object metadata with HEAD and fails on mixed or unexpected listing',async()=>{
 const {bucket}=fixture((name,args)=>{
  if(name==='HeadObject')return {ETag:'"pin"',ContentLength:5,Metadata:{sha256:digest}};
  assert.deepEqual([args.Prefix,args.MaxKeys,args.ContinuationToken],['a/',7,'next']);
  return {IsTruncated:true,NextContinuationToken:'more',Contents:[{Key:'a/item',Size:5,ETag:'"pin"'}]};
 });
 const result=await bucket.list({prefix:'a/',limit:7,cursor:'next',include:['customMetadata']});
 assert.equal(result.cursor,'more');
 assert.equal(result.objects[0].customMetadata.sha256,digest);
 const unsafe=fixture(()=>({Contents:[{Key:'unapproved',Size:5,ETag:'"x"'}]}));
 await assert.rejects(unsafe.bucket.list({prefix:'a/'}),/UNAVAILABLE/);
});

test('multipart stays streamed with explicit length and create-only completion; deletes handle errors',async()=>{
 const {bucket,calls}=fixture(async(name,args)=>{
  if(name==='CreateMultipartUpload')return {UploadId:'upload-id'};
  if(name==='UploadPart'){
   assert.equal(args.ContentLength,3);
   const chunks=[];for await(const chunk of args.Body)chunks.push(chunk);
   assert.deepEqual(Buffer.concat(chunks),Buffer.from([1,2,3]));
   return {ETag:'"part"'};
  }
  if(name==='CompleteMultipartUpload'){
   assert.equal(args.IfNoneMatch,'*');
   assert.deepEqual(args.MultipartUpload,{Parts:[{PartNumber:1,ETag:'"part"'}]});
  }
  if(name==='HeadObject')return {ETag:'"done"',ContentLength:3,Metadata:{sha256:digest}};
  if(name==='DeleteObjects')return {Errors:[{Key:'keep',Code:'AccessDenied'}]};
  return {};
 });
 const upload=await bucket.createMultipartUpload('key',{customMetadata:{sha256:digest}});
 const resumed=bucket.resumeMultipartUpload(upload.key,upload.uploadId);
 const part=await resumed.uploadPart(1,body(bytes(1,2,3)),3);
 assert.equal((await resumed.complete([part])).etag,'"done"');
 await resumed.abort();
 await bucket.delete('old-key');
 await assert.rejects(bucket.delete(['keep']),/UNAVAILABLE/);
 assert.deepEqual(calls.map(c=>c.name),['CreateMultipartUpload','UploadPart','CompleteMultipartUpload','HeadObject',
  'AbortMultipartUpload','DeleteObject','DeleteObjects']);
});

test('real factory pins local endpoint and validates private canonical config without loading or calling SDK',async t=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'ngs-s3-private-fixture-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const config={bucketName:'ngs-local',accessKeyId:'fixture-user',secretAccessKey:'synthetic-private-value'};
 const configPath=join(dir,'owner.json');
 writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 assert.deepEqual(readLocalS3ReplicaConfig(configPath),config);
 let loaded=0;
 const bucket=await openLocalS3ReplicaBucket({configPath,load:async()=>{
  loaded++;
  return {...impl,S3Client:class{
   constructor(c){assert.equal(c.endpoint,'http://127.0.0.1:9000');assert.equal(c.forcePathStyle,true);assert.equal(c.maxAttempts,1);}
   send(){assert.fail('no network in fixture');}
  }};
 }});
 assert.equal(typeof bucket.head,'function');assert.equal(loaded,1);
 const link=join(dir,'link');symlinkSync(configPath,link);
 assert.throws(()=>readLocalS3ReplicaConfig(link),/CONFIGURATION_INVALID/);
 chmodSync(configPath,0o644);
 assert.throws(()=>readLocalS3ReplicaConfig(configPath),/CONFIGURATION_INVALID/);
});
