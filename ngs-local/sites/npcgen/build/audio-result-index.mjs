/** Shared verified audio metadata and keyset projection. No object I/O. */
import {createHash} from 'node:crypto';
export const audioSummaryLimit=64*1024;
export const audioPageSize=30;
export const audioOfficialId=/^request\.official\.[a-f0-9]{64}$/u;
const sha=/^[a-f0-9]{64}$/u,sourceId=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const resultPath=/^audio\/(request\.official\.[a-f0-9]{64})\/(metadata\.json|audio\.wav)$/u;
const cursorPattern=/^a1\.(0|[1-9][0-9]{0,15})\.([a-f0-9]{64})$/u;
const digest=x=>createHash('sha256').update(x).digest('hex');
const fits=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const invalid=()=>{throw Object.assign(Error('AUDIO_RESULT_INPUT_INVALID'),{status:400});};
export function audioIndexPath(path){return resultPath.exec(path);}
export function audioResultSummary(meta,id){
 const a=meta?.audio,s=meta?.separation;
 const separated=meta!=null&&Object.hasOwn(meta,'separation');
 if(separated&&(!s||Object.keys(s).sort().join(',')!=='sourceOfficialRequestId,sourceSha256'||
    typeof s.sourceOfficialRequestId!=='string'||!audioOfficialId.test(s.sourceOfficialRequestId)||s.sourceOfficialRequestId===id||
    typeof s.sourceSha256!=='string'||!sha.test(s.sourceSha256)))return null;
 const validHash=x=>typeof x==='string'&&sha.test(x);
 const task=separated?'audio_separate':'audio_generate';
 if(meta?.schemaVersion!=='workflow.audio-result.v1'||meta.officialRequestId!==id||meta.projectId!=='binari'||meta.kind!=='bgm'||
    meta.taskId!=='workflow.task.'+digest(JSON.stringify([id,task]))||!validHash(meta.payloadSha256)||
    typeof meta.conceptId!=='string'||!sourceId.test(meta.conceptId)||meta.source?.conceptId!==meta.conceptId||
    !validHash(meta.source.sectionSha256)||typeof meta.title!=='string'||!meta.title.isWellFormed()||!meta.title.trim()||[...meta.title].length>120||
    a?.path!=='audio.wav'||a.mimeType!=='audio/wav'||!validHash(a.sha256)||!fits(a.bytes,44,24*1024*1024)||
    ![1,2].includes(a.channels)||a.bitsPerSample!==16||!fits(a.sampleRate,8000,96000)||!fits(a.frames,1,24*1024*1024)||
    a.bytes!==44+a.frames*a.channels*2||a.durationSeconds!==a.frames/a.sampleRate)return null;
 return {id,title:meta.title,bpm:meta.bpmBasis==='model'&&fits(meta.bpm,30,300)?meta.bpm:null,separated,
  generatedAt:fits(meta.generatedAt,1,Number.MAX_SAFE_INTEGER)?meta.generatedAt:0,sha256:a.sha256,bytes:a.bytes,durationSeconds:a.durationSeconds};
}
export function readAudioIndexBytes(bytes,id,sha256){
 if(!bytes||bytes.byteLength>audioSummaryLimit||digest(bytes)!==sha256)return null;
 try{return audioResultSummary(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),id);}catch{return null;}
}
export function audioIndexQuery(query){
 const projectId=query.get('projectId'),keys=[...query.keys()].sort().join(',');
 if(projectId!=='binari')return invalid();
 if(keys==='projectId')return {projectId};
 if(keys==='cursor,projectId'){const cursor=query.get('cursor');parseAudioCursor(cursor);return {projectId,cursor};}
 if(keys==='projectId,resultId'){
  const resultId=query.get('resultId');
  if(audioOfficialId.test(resultId))return {projectId,resultId};
 }
 return invalid();
}
export function parseAudioCursor(cursor){
 const m=typeof cursor==='string'&&cursorPattern.exec(cursor);
 if(!m||!Number.isSafeInteger(Number(m[1])))return invalid();
 return {date:Number(m[1]),id:'request.official.'+m[2]};
}
export const audioCursor=({generated_at,id})=>'a1.'+generated_at+'.'+id.slice('request.official.'.length);
export function audioIndexResult({id,title,bpm,separated,duration_seconds,metadata_audio_sha}){
 return {title,bpm,bpmBasis:bpm===null?'unavailable':'model',durationSeconds:duration_seconds,...(separated?{separated:true}:{}),
  url:'/api/audio-workspace?'+new URLSearchParams({projectId:'binari',id,sha256:metadata_audio_sha})};
}

const table='ngs_audio_result_index_v1', progress='ngs_audio_result_index_progress_v1', versions='ngs_replica_version_v2';
const visibility='title IS NOT NULL AND metadata_audio_sha=wav_sha AND metadata_audio_size=wav_size';
const pageFields='id, generated_at, title, bpm, separated, duration_seconds, metadata_audio_sha';
export function createAudioResultIndex(db){
 const stmt=(sql,...args)=>db.prepare(sql).bind(...args);
 const first=(sql,...args)=>stmt(sql,...args).first();
 const current=path=>`COALESCE((SELECT MAX(version) FROM ${versions} WHERE path=${path}),0)`;
 const measures=summary=>summary?[summary.generatedAt,summary.title,summary.bpm,Number(summary.separated),summary.durationSeconds,
  summary.sha256,summary.bytes]:Array(7).fill(null);
 const metadata=(id,summary,source,...bindings)=>stmt(`INSERT INTO ${table}
  (id,generated_at,title,bpm,separated,duration_seconds,metadata_audio_sha,metadata_audio_size,metadata_version)
  SELECT ?,?,?,?,?,?,?,?,version FROM (${source}) WHERE 1
  ON CONFLICT(id) DO UPDATE SET metadata_version=excluded.metadata_version,generated_at=excluded.generated_at,
  title=excluded.title,bpm=excluded.bpm,separated=excluded.separated,duration_seconds=excluded.duration_seconds,
  metadata_audio_sha=excluded.metadata_audio_sha,metadata_audio_size=excluded.metadata_audio_size
  WHERE excluded.metadata_version>${table}.metadata_version`,id,...measures(summary),...bindings);
 const wav=(id,source,...bindings)=>stmt(`INSERT INTO ${table}(id,wav_version,wav_sha,wav_size)
  SELECT ?,version,sha256,size FROM (${source}) WHERE 1
  ON CONFLICT(id) DO UPDATE SET wav_version=excluded.wav_version,wav_sha=excluded.wav_sha,wav_size=excluded.wav_size
  WHERE excluded.wav_version>${table}.wav_version`,id,...bindings);
 function publish(path,summary,key){
  const match=audioIndexPath(path);
  if(!match)return [];
  const [,id,name]=match;
  const source=`SELECT version,sha256,size FROM ${versions} WHERE object_key=? AND path=?
   AND version=${current('?')}`;
  return [name==='metadata.json'?metadata(id,summary,source,key,path,path):wav(id,source,key,path,path)];
 }
 function remove(path,sha256,sync){
  const match=audioIndexPath(path);
  if(!match)return [];
  const [,id,name]=match;
  const source=`SELECT version,NULL AS sha256,NULL AS size FROM ${versions} WHERE path=? AND sync_id=? AND sha256=?
    AND object_key IS NULL AND version=${current('?')}`;
  return [name==='metadata.json'?metadata(id,null,source,path,sync,sha256,path):wav(id,source,path,sync,sha256,path)];
 }
 async function lookupVersion(path){
  const row=await first(`SELECT version,object_key,sha256,size FROM ${versions} WHERE path=? ORDER BY version DESC LIMIT 1`,path);
  return row??{version:0};
 }
 async function backfillOne(id,head,get){
  const mp='audio/'+id+'/metadata.json',wp='audio/'+id+'/audio.wav';
  const [mv,wv]=await Promise.all([lookupVersion(mp),lookupVersion(wp)]);
  // Versioned WAV evidence was already byte-verified at publication. For a
  // pre-versioned legacy key verify its current replica digest and size once.
  const oldWav=wv.version===0?await head(wp):null;
  let summary=null;
  if(mv.version===0||mv.object_key){
   const object=await get(mp);
   if(object){
    if(mv.version>0&&object.customMetadata?.sha256!==mv.sha256)throw Error('AUDIO_INDEX_REPLICA_CHANGED');
    if(fits(object.size,2,audioSummaryLimit))summary=readAudioIndexBytes(new Uint8Array(await object.arrayBuffer()),id,object.customMetadata.sha256);
    else await object.body?.cancel();
   }
  }
  const expectedWav=wv.version===0?{sha:oldWav?.customMetadata?.sha256??null,size:oldWav?.size??null}:
   {sha:wv.object_key?wv.sha256:null,size:wv.object_key?wv.size:null};
  await db.batch([
   metadata(id,summary,`SELECT ? AS version WHERE ${current('?')}=?`,mv.version,mp,mv.version),
   wav(id,`SELECT ? AS version,? AS sha256,? AS size WHERE ${current('?')}=?`,
    wv.version,expectedWav.sha,expectedWav.size,wp,wv.version),
  ]);
 }
 async function backfill(inventory,head,get){
  // Called only by machine sync, never by browser page loads. Reuses the
  // already-read sync inventory. Each pass consumes at most 12 legacy rows.
  const s=await first(`SELECT last_id,complete FROM ${progress} WHERE id=1`);
  if(s?.complete===1)return;
  const last=s?.last_id??'';
  const found=inventory.flatMap(({path})=>{
   const match=audioIndexPath(path);return match?.[2]==='metadata.json'&&match[1]>last?[match[1]]:[];
  }).sort();
  const picked=found.slice(0,12);
  for(const id of picked)await backfillOne(id,head,get);
  await stmt(`INSERT INTO ${progress}(id,last_id,complete) VALUES(1,?,?)
   ON CONFLICT(id) DO UPDATE SET last_id=excluded.last_id,complete=excluded.complete
   WHERE ${progress}.last_id<=excluded.last_id AND ${progress}.complete=0`,
   picked.at(-1)??last,Number(found.length<=picked.length)).run();
 }
 async function read(args){
  if(!args||args.projectId!=='binari'||Object.keys(args).some(k=>!['projectId','cursor','resultId'].includes(k))||
     (args.resultId!==undefined&&(args.cursor!==undefined||!audioOfficialId.test(args.resultId))))return invalid();
  const {projectId,resultId,cursor}=args;
  if((await first(`SELECT complete FROM ${progress} WHERE id=1`))?.complete!==1)
   throw Object.assign(Error('AUDIO_INDEX_PREPARING'),{status:503});
  if(resultId!==undefined){
   const row=await first(`SELECT ${pageFields} FROM ${table} WHERE id=? AND ${visibility}`,resultId);
   return {projectId,result:row?audioIndexResult(row):null};
  }
  const bound=cursor===undefined?null:parseAudioCursor(cursor);
  const rows=(await stmt(`SELECT ${pageFields} FROM ${table} WHERE ${visibility}
   ${bound?'AND (generated_at,id)<(?,?)':''} ORDER BY generated_at DESC,id DESC LIMIT ${audioPageSize+1}`,
   ...(bound?[bound.date,bound.id]:[])).all()).results;
  const page=rows.slice(0,audioPageSize);
  return {projectId,results:page.map(audioIndexResult),nextCursor:rows.length>audioPageSize?audioCursor(page.at(-1)):null};
 }
 return {publish,remove,backfill,read};
}
