/** Native Mac object-storage composition. No configured external URL or credentials. */
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {objectReplicaSyncTools} from './object-replica.mjs';
const url='http://127.0.0.1';
const modules=['local-miniflare-worker','object-replica','audio-result-index','replica-whole-file-wire'];
const volume='/Volumes/무제';
const bootSql=['0014_space_file_replica_versions.sql','0015_replica_sync_progress.sql','0016_audio_result_index.sql'];
const newTables=['ngs_audio_result_index_v1','ngs_audio_result_index_progress_v1'];
const tableNames=['ngs_replica_pass_v2','ngs_replica_progress_item_v1','ngs_replica_progress_v1',
 'ngs_replica_receive_v2','ngs_replica_reset_v2','ngs_replica_version_v2'];
const down=()=>Object.assign(Error('NGS_MINIFLARE_UNAVAILABLE'),{status:503});
const configured=()=>Object.assign(Error('NGS_MINIFLARE_PRIVATE_PATH_REQUIRED'),{status:503});
const sha=content=>createHash('sha256').update(content).digest('hex');

function privateRoot(path,fixture=false){
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||realpathSync(path)!==path)throw configured();
 const info=lstatSync(path);
 if(!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o777)!==0o700)throw configured();
 if(!fixture&&(!path.startsWith(volume+'/NGS-Miniflare-')||path.slice(volume.length+1).includes('/')||
  info.dev!==lstatSync(volume).dev||info.dev===lstatSync('/Volumes').dev))throw configured();
 return path;
}
const defaultLoad=async()=>{
 const require=createRequire(new URL('../../../local-miniflare/package.json',import.meta.url));
 return require('miniflare').Miniflare;
};
async function migration(db){
 const statements=bootSql.map(file=>readFileSync(new URL('../../../dev/'+file,import.meta.url),'utf8'));
 const schemaHash=sha(statements.join('\0'));
 const exists=async()=> (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r=>r.name);
 const previous=[...tableNames,'ngs_local_replica_schema_pin'].sort();
 const known=[...previous,...newTables].sort();let actual=await exists();
 const pinned=async()=>(await db.prepare('SELECT sha256 FROM ngs_local_replica_schema_pin WHERE id=1').first())?.sha256;
 if(JSON.stringify(actual)===JSON.stringify(previous)&&await pinned()===sha(statements.slice(0,-1).join('\0'))){
  await db.batch([
   ...statements.at(-1).split('--> statement-breakpoint').filter(x=>x.trim()).map(sql=>db.prepare(sql)),
   db.prepare('UPDATE ngs_local_replica_schema_pin SET sha256=? WHERE id=1').bind(schemaHash),
  ]);
  actual=await exists();
 }
 if(actual.length===0){
  await db.batch([
   ...statements.flatMap(r=>r.split('--> statement-breakpoint').filter(x=>x.trim())).map(sql=>db.prepare(sql)),
   db.prepare('CREATE TABLE ngs_local_replica_schema_pin (id INTEGER PRIMARY KEY CHECK (id=1),sha256 TEXT NOT NULL)'),
   db.prepare('INSERT INTO ngs_local_replica_schema_pin (id,sha256) VALUES (1,?)').bind(schemaHash),
  ]);
  actual=await exists();
 }
 if(JSON.stringify(actual)!==JSON.stringify(known)||
  await pinned()!==schemaHash)throw down();
 return schemaHash;
}
function parsedError(response,value){
 const message=value?.error;
 return Number.isInteger(response.status)&&response.status>=400&&response.status<500&&/^[A-Z0-9_]+$/.test(message??'')
  ?Object.assign(Error(message),{status:response.status}):down();
}
export async function openLocalMiniflareReplica({persistRoot,fixture=false,load=defaultLoad}={}){
 const root=privateRoot(persistRoot,fixture);
 const d1=join(root,'d1'),r2=join(root,'r2');
 for(const child of [d1,r2]){
  try{const s=lstatSync(child);if(!s.isDirectory()||s.dev!==lstatSync(root).dev||realpathSync(child)!==child)throw configured();}
  catch(e){if(e?.code!=='ENOENT')throw e;}
 }
 const cap=randomBytes(32).toString('hex'),Miniflare=await load();
 const mf=new Miniflare({host:'127.0.0.1',port:0,
  d1Databases:{DB:'ngs-local-replica'},r2Buckets:{BUCKET:'ngs-local-replica'},d1Persist:d1,r2Persist:r2,
  bindings:{NGS_INTERNAL:cap},compatibilityDate:'2025-11-01',compatibilityFlags:['nodejs_compat'],
  modules:modules.map(name=>({type:'ESModule',path:name+'.mjs',contents:readFileSync(new URL('./'+name+'.mjs',import.meta.url),'utf8')})),
 });
 let schemaHash;
 try{schemaHash=await migration(await mf.getD1Database('DB'));}
 catch(e){await mf.dispose();throw e;}
 const io=async(path,{headers, ...init}={})=>mf.dispatchFetch(url+path,{
  method:'POST',...init,headers:{...headers,'x-ngs-internal':cap},
 });
 const json=async(op,...args)=>{
  const response=await io('/call',{headers:{'Content-Type':'application/json'},body:JSON.stringify({op,args})});
  const result=await response.json().catch(()=>{throw down();});
  if(!response.ok)throw parsedError(response,result);
  return result.value;
 };
 const replica=Object.freeze({
  call:(...args)=>json('call',...args),list:(...args)=>json('list',...args),head:(...args)=>json('head',...args),
  progress:()=>json('progress'),audioIndex:(...args)=>json('audioIndex',...args),
  async get(path,options={}){
   const response=await io('/call',{headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'get',args:[path,options]})});
   if(response.status===404)return null;
   if(!response.ok)throw parsedError(response,await response.json().catch(()=>null));
   const header=response.headers.get('x-ngs-storage-meta');
   if(!header||!response.body)throw down();
   const meta=JSON.parse(header);
   return {...meta,body:response.body,arrayBuffer:()=>response.arrayBuffer()};
  },
  async readVerifiedPng(path,sha256,max){
   const response=await io('/call',{headers:{'Content-Type':'application/json'},
    body:JSON.stringify({op:'verified-png',args:[path,sha256,max]})});
   if(response.status===204)return undefined;
   if(response.status===404)return null;
   if(!response.ok)throw parsedError(response,await response.json().catch(()=>null));
   const length=Number(response.headers.get('Content-Length'));
   if(response.headers.get('Content-Type')!=='image/png'||!Number.isSafeInteger(length)||length<8||length>max)throw down();
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length!==length)throw down();
   return bytes;
  },
  async receiveWholeFile({syncId,path,sha256,size},body){
   const response=await io('/raw',{headers:{'Content-Type':'application/octet-stream','Content-Length':String(size),
    'X-NGS-Sync-Id':syncId,'X-NGS-File-Path':Buffer.from(path).toString('base64url'),'X-NGS-File-Sha256':sha256},
    ...(size?{body,duplex:'half'}:{})});
   const value=await response.json().catch(()=>null);
   if(!response.ok)throw parsedError(response,value);
   if(value?.ok!==true)throw down();
   return value;
  },
  npcCache:Object.freeze({version:()=>json('cache-version'),read:(...args)=>json('cache-read',...args),store:(...args)=>json('cache-store',...args)}),
 });
 return {replica,fileSyncToolDefinitions:objectReplicaSyncTools,schemaHash,close:()=>mf.dispose()};
}
