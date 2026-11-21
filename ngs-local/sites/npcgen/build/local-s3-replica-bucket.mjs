/** The narrow R2 bucket surface used by the portable replica, backed by local S3. */
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';

export const localS3ReplicaEndpoint='http://127.0.0.1:9000';
const root=realpathSync(fileURLToPath(new URL('../../../../',import.meta.url)));
const names=['HeadObject','GetObject','ListObjectsV2','PutObject','DeleteObject','DeleteObjects',
 'CreateMultipartUpload','UploadPart','CompleteMultipartUpload','AbortMultipartUpload'];
const invalid=()=>Error('NGS_REPLICA_S3_INPUT_INVALID');
const unavailable=()=>Error('NGS_REPLICA_S3_UNAVAILABLE');
const configError=()=>Error('NGS_REPLICA_S3_CONFIGURATION_INVALID');
const int=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const sha=v=>typeof v==='string'&&v.length===64&&/^[0-9a-f]+$/.test(v);
const etag=v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x20\x7f]/.test(v);
const keyValid=(v,min=1)=>typeof v==='string'&&v.isWellFormed()&&Buffer.byteLength(v)>=min&&Buffer.byteLength(v)<=1024&&!/[\x00-\x1f\x7f]/.test(v);
const bucketValid=v=>typeof v==='string'&&v.length>=3&&v.length<=63&&/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(v);
const status=e=>e?.$metadata?.httpStatusCode;
const absent=e=>status(e)===404;
const conditional=e=>status(e)===412||status(e)===304;
const stream=v=>v instanceof ReadableStream;

function metadata(row){
 if(!row||!etag(row.ETag)||!int(row.ContentLength))throw unavailable();
 const options=row.Metadata??{};
 const customMetadata=Object.create(null);
 for(const [k,v] of Object.entries(options)){
  if(typeof v==='string')customMetadata[k.toLowerCase()]=v;
 }
 return {etag:row.ETag,size:row.ContentLength,customMetadata};
}
function condition(onlyIf,put=false){
 if(onlyIf===undefined)return {};
 if(put&&onlyIf instanceof Headers&&[...onlyIf.keys()].join(',')==='if-none-match'&&onlyIf.get('If-None-Match')==='*')
  return {IfNoneMatch:'*'};
 if(!put&&onlyIf&&Object.keys(onlyIf).join(',')==='etagMatches'&&etag(onlyIf.etagMatches))
  return {IfMatch:onlyIf.etagMatches};
 throw invalid();
}
function checkedRange(range){
 if(range===undefined)return null;
 if(!range||Object.keys(range).sort().join(',')!=='length,offset'||!int(range.offset)||
    !int(range.length,1)||!int(range.offset+range.length-1))throw invalid();
 return {start:range.offset,end:range.offset+range.length-1};
}
function metaInput(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||
  Object.keys(value).some(k=>!['sha256','removed'].includes(k))||
  (Object.hasOwn(value,'sha256')&&!sha(value.sha256))||(Object.hasOwn(value,'removed')&&value.removed!=='1'))throw invalid();
 return {...value};
}

export function createS3ReplicaBucket({client,commands,bucketName}={}){
 if(typeof client?.send!=='function'||!bucketValid(bucketName)||!names.every(n=>typeof commands?.[n+'Command']==='function'))throw configError();
 const call=(name,input)=>client.send(new commands[name+'Command']({Bucket:bucketName,...input}));
 const K=Key=>{if(!keyValid(Key))throw invalid();return {Key};};
 async function head(key){
  try{return metadata(await call('HeadObject',K(key)));}
  catch(e){if(absent(e))return null;throw e;}
 }
 async function get(key,options={}){
  const range=checkedRange(options.range),conds=condition(options.onlyIf);
  let row;
  try{row=await call('GetObject',{...K(key),...conds,...(range?{Range:'bytes='+range.start+'-'+range.end}:{})});}
  catch(e){
   if(absent(e))return null;
   if(conditional(e)&&conds.IfMatch!==undefined)return head(key); // R2 metadata-only conditional miss.
   throw e;
  }
  let body;
  try{
   body=stream(row.Body)?row.Body:row.Body?.transformToWebStream?.();
   if(!stream(body))throw unavailable();
   let size=row.ContentLength;
   if(range){
    const result=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(row.ContentRange??'');
    if(!result)throw unavailable();
    const [,first,last,total]=result.map(Number);
    if(first!==range.start||!int(total,1)||first>=total||last!==Math.min(range.end,total-1)||
       row.ContentLength!==last-first+1)throw unavailable();
    size=total;
   }
   const info=metadata({...row,ContentLength:size});
   if(conds.IfMatch!==undefined&&info.etag!==conds.IfMatch)throw unavailable();
   return {...info,body,arrayBuffer:()=>new Response(body).arrayBuffer()};
  }catch(e){if(body)void body.cancel().catch(()=>{});else row?.Body?.destroy?.();throw e;}
 }
 async function put(key,body,{onlyIf,sha256,customMetadata}={}){
  if(!(body instanceof Uint8Array)||sha256!==undefined&&!sha(sha256))throw invalid();
  const meta=metaInput(customMetadata);
  if(sha256!==undefined&&meta?.sha256!==sha256)throw invalid();
  let value;
  try{
   value=await call('PutObject',{...K(key),Body:body,ContentLength:body.byteLength,Metadata:meta,
    ...condition(onlyIf,true),...(sha256?{ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64')}: {})});
  }catch(e){if(status(e)===412&&onlyIf!==undefined)return null;throw e;}
  if(!etag(value?.ETag))throw unavailable();
  return {etag:value.ETag,size:body.byteLength,customMetadata:meta??{}};
 }
 async function list({prefix='',limit=1000,include=[],cursor}={}){
  if(!keyValid(prefix,0)||!int(limit,1,1000)||!Array.isArray(include)||include.some(v=>v!=='customMetadata')||
     cursor!==undefined&&(typeof cursor!=='string'||!cursor.length||cursor.length>8192))throw invalid();
  const reply=await call('ListObjectsV2',{Prefix:prefix,MaxKeys:limit,ContinuationToken:cursor});
  const rows=reply.Contents??[];
  if(!Array.isArray(rows)||rows.length>limit||rows.some(r=>!keyValid(r.Key)||!r.Key.startsWith(prefix)||!etag(r.ETag)||!int(r.Size)))throw unavailable();
  const objects=rows.map(row=>({key:row.Key,size:row.Size,etag:row.ETag}));
  if(include.includes('customMetadata')){
   // S3 ListObjectsV2 omits user metadata. Use bounded concurrent exact HEADs.
   let at=0;
   await Promise.all(Array.from({length:Math.min(8,objects.length)},async()=>{
    for(let i;(i=at++)<objects.length;){
     const item=objects[i],value=await head(item.key);
     if(!value||value.etag!==item.etag||value.size!==item.size)throw unavailable();
     item.customMetadata=value.customMetadata;
    }
   }));
  }
  const truncated=reply.IsTruncated===true;
  if(truncated&&(typeof reply.NextContinuationToken!=='string'||!reply.NextContinuationToken||reply.NextContinuationToken===cursor))throw unavailable();
  return {objects,truncated,...(truncated?{cursor:reply.NextContinuationToken}:{})};
 }
 async function remove(key){
  if(!Array.isArray(key)){await call('DeleteObject',K(key));return;}
  if(key.length>1000)throw invalid();
  if(!key.length)return;
  const result=await call('DeleteObjects',{Delete:{Objects:key.map(K),Quiet:true}});
  if(result.Errors?.length)throw unavailable();
 }
 function resumeMultipartUpload(key,uploadId){
  const address=K(key);
  if(typeof uploadId!=='string'||uploadId.length<1||uploadId.length>8192||/[\x00-\x1f\x7f]/.test(uploadId))throw invalid();
  const base={...address,UploadId:uploadId};
  return {
   key,uploadId,
   async uploadPart(partNumber,source,length){
    if(!int(partNumber,1,10000)||!int(length,1,5*1024**3))throw invalid();
    const Body=stream(source)?Readable.fromWeb(source):source;
    if(!(Body instanceof Readable)&&!(Body instanceof Uint8Array)||Body instanceof Uint8Array&&Body.byteLength!==length)throw invalid();
    try{
     const r=await call('UploadPart',{...base,PartNumber:partNumber,Body,ContentLength:length});
     if(!etag(r.ETag))throw unavailable();
     return {partNumber,etag:r.ETag};
    }catch(e){Body.destroy?.();throw e;}
   },
   async complete(parts){
    if(!Array.isArray(parts)||!parts.length||parts.length>10000||
       parts.some((p,i)=>p?.partNumber!==i+1||!etag(p.etag)))throw invalid();
    // Enforce immutable attempt keys at the S3 provider, never HEAD + overwrite.
    await call('CompleteMultipartUpload',{...base,IfNoneMatch:'*',
     MultipartUpload:{Parts:parts.map(p=>({PartNumber:p.partNumber,ETag:p.etag}))}});
    const result=await head(key);if(!result)throw unavailable();return result;
   },
   async abort(){try{await call('AbortMultipartUpload',base);}catch(e){if(!absent(e))throw e;}},
  };
 }
 async function createMultipartUpload(key,{customMetadata}={}){
  const r=await call('CreateMultipartUpload',{...K(key),Metadata:metaInput(customMetadata)});
  return resumeMultipartUpload(key,r.UploadId);
 }
 return {head,get,list,put,delete:remove,createMultipartUpload,resumeMultipartUpload,close:()=>client.destroy?.()};
}

export function readLocalS3ReplicaConfig(configPath){
 try{
  if(typeof configPath!=='string'||!isAbsolute(configPath)||resolve(configPath)!==configPath||
     configPath.startsWith(root+sep)||realpathSync(configPath)!==configPath)throw configError();
  const owner=process.getuid(),parent=lstatSync(dirname(configPath));
  if(!parent.isDirectory()||parent.uid!==owner||parent.mode&0o022)throw configError();
  const fd=openSync(configPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const before=fstatSync(fd),file=lstatSync(configPath);
   if(!before.isFile()||before.uid!==owner||(before.mode&0o7777)!==0o600||before.nlink!==1||
      !int(before.size,2,4096)||before.ino!==file.ino||before.dev!==file.dev)throw configError();
   const body=Buffer.alloc(4097);
   let n=0;
   while(n<body.length){
    const got=readSync(fd,body,n,body.length-n,null);
    if(got===0)break;n+=got;
   }
   const after=fstatSync(fd);
   if(n!==before.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw configError();
   const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.subarray(0,n)));
   if(Object.keys(config).sort().join(',')!=='accessKeyId,bucketName,secretAccessKey'||!bucketValid(config.bucketName)||
      ![config.accessKeyId,config.secretAccessKey].every(v=>typeof v==='string'&&v.length>=3&&v.length<=256&&/^[!-~]+$/.test(v)))
    throw configError();
   return config;
  }finally{closeSync(fd);}
 }catch{throw configError();}
}

export async function openLocalS3ReplicaBucket({configPath,load=()=>import('@aws-sdk/client-s3')}={}){
 const {bucketName,accessKeyId,secretAccessKey}=readLocalS3ReplicaConfig(configPath);
 const sdk=await load();
 const client=new sdk.S3Client({endpoint:localS3ReplicaEndpoint,forcePathStyle:true,region:'us-east-1',maxAttempts:1,
  requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',credentials:{accessKeyId,secretAccessKey}});
 return createS3ReplicaBucket({client,commands:sdk,bucketName});
}
