/** Read the active PDS replica only. No request, worker, or archive access. */
import {createHash} from 'node:crypto';
import {lstatSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {localWorkspaceReplica as fs} from './local-project-workspace.mjs';
import {audioResultTaskKey} from './local-audio-workspace.mjs';

const official=/^request\.official\.[a-f0-9]{64}$/;
const sha=/^[a-f0-9]{64}$/;
const sourceId=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const maximum=24*1024*1024;
const fault=(code,status)=>Object.assign(Error(code),{status});
const missing=()=>fault('AUDIO_RESULT_NOT_FOUND',404);
const invalid=()=>fault('AUDIO_RESULT_INPUT_INVALID',400);
const unavailable=()=>fault('AUDIO_RESULT_UNAVAILABLE',503);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function record(root,id){
 const directory='audio/'+id,meta=fs.readObject(root,directory+'/metadata.json');
 const a=meta?.audio,task=meta&&audioResultTaskKey(meta,id);
 if(meta?.schemaVersion!=='workflow.audio-result.v1'||meta.officialRequestId!==id||meta.projectId!=='binari'||meta.kind!=='bgm'||
    !task||meta.taskId!=='workflow.task.'+hash(JSON.stringify([id,task]))||
    typeof meta.payloadSha256!=='string'||!sha.test(meta.payloadSha256)||typeof meta.conceptId!=='string'||!sourceId.test(meta.conceptId)||
    meta.source?.conceptId!==meta.conceptId||typeof meta.source.sectionSha256!=='string'||!sha.test(meta.source.sectionSha256)||
    typeof meta.title!=='string'||!meta.title.trim()||[...meta.title].length>120||
    a?.path!=='audio.wav'||a.mimeType!=='audio/wav'||typeof a.sha256!=='string'||!sha.test(a.sha256)||
    !Number.isSafeInteger(a.bytes)||a.bytes<44||a.bytes>maximum||![1,2].includes(a.channels)||a.bitsPerSample!==16||
    !Number.isSafeInteger(a.sampleRate)||a.sampleRate<8000||a.sampleRate>96000||
    !Number.isSafeInteger(a.frames)||a.frames<1||a.bytes!==44+a.frames*a.channels*2||
    !Number.isFinite(a.durationSeconds)||a.durationSeconds!==a.frames/a.sampleRate)return null;
 const physical=fs.safeDirectory(root,directory),relative=directory+'/audio.wav';
 if(!physical)return null;
 let st;
 try{st=lstatSync(join(physical,'audio.wav'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!st.isFile()||st.uid!==process.getuid()||st.mode&0o077||st.nlink!==1||st.size!==a.bytes)return null;
 return {meta,a,relative,separated:task==='audio_separate'};
}
export function localAudioSeparationSource(root,{sourceOfficialRequestId,sourceSha256}){
 const project=fs.safeDirectory(root,'binari'),row=project&&record(project,sourceOfficialRequestId);
 return Boolean(row&&!row.separated&&row.a.sha256===sourceSha256);
}
function userResult({meta,a,separated}){
 const bpm=meta.bpmBasis==='model'&&Number.isInteger(meta.bpm)&&meta.bpm>=30&&meta.bpm<=300?meta.bpm:null;
 return {title:meta.title,bpm,bpmBasis:bpm===null?'unavailable':'model',durationSeconds:a.durationSeconds,
  ...(separated?{separated:true}:{}),
  url:'/api/audio-workspace?'+new URLSearchParams({projectId:'binari',id:meta.officialRequestId,sha256:a.sha256})};
}

export function localAudioResults({root,query,authorize}){
 const projectId=query.get('projectId'),id=query.get('id'),digest=query.get('sha256'),keys=[...query.keys()].sort().join(',');
 if(!projectId||keys!==(id===null?'projectId':'id,projectId,sha256')||
    id!==null&&(!official.test(id)||typeof digest!=='string'||!sha.test(digest)))throw invalid();
 authorize(projectId);
 if(projectId!=='binari')throw missing();
 const project=fs.safeDirectory(root,projectId),directory=project&&fs.safeDirectory(project,'audio');
 if(!directory){if(id!==null)throw missing();return {json:{projectId,results:[]}};}
 if(id!==null){
  const row=record(project,id);
  if(!row||row.a.sha256!==digest)throw missing();
  const bytes=fs.readBytes(project,row.relative,maximum);
  if(!bytes||bytes.length!==row.a.bytes||hash(bytes)!==digest||
     bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw unavailable();
  // Match current proof again before returning any bytes, including Range responses.
  const current=record(project,id);
  if(!current||current.a.sha256!==digest||current.a.bytes!==bytes.length)throw unavailable();
  return {bytes,mime:'audio/wav'};
 }
 const entries=readdirSync(directory,{withFileTypes:true});
 if(entries.length>4096||fs.safeDirectory(project,'audio')!==directory)throw unavailable();
 const results=[];
 for(const entry of entries){
  if(!entry.isDirectory()||!official.test(entry.name))continue;
  try{const row=record(project,entry.name);if(row)results.push(row);}
  catch{/* An unreadable result never becomes a playable or complete-looking item. */}
 }
 // Publication time is canonical metadata, never replica file mtime or title.
 // Unknown historical dates sort before dated results in a stable order.
 const generatedAt=row=>Number.isSafeInteger(row.meta.generatedAt)&&row.meta.generatedAt>0?row.meta.generatedAt:0;
 results.sort((a,b)=>generatedAt(a)-generatedAt(b)||a.meta.officialRequestId.localeCompare(b.meta.officialRequestId));
 return {json:{projectId,results:results.map(userResult)}};
}

export function audioResponseRange(header,size){
 if(header===undefined)return {start:0,end:size-1};
 const m=typeof header==='string'&&/^bytes=(\d{0,12})-(\d{0,12})$/.exec(header);
 if(!m||!m[1]&&!m[2])return null;
 const suffix=!m[1],end=suffix||!m[2]?size-1:Math.min(size-1,Number(m[2]));
 const start=suffix?Math.max(0,size-Number(m[2])):Number(m[1]);
 return start<=end?{start,end}:null;
}
