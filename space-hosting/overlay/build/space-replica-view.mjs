/** Project-granted views of verified Binari replica data, never a raw file endpoint. */
const projectId='binari',project='/api/project-folders',icon=project+'/icon',audio='/api/audio-workspace',concepts='/api/space/audio-concepts';
const limit=24*1024*1024,metadataLimit=64*1024,iconLimit=2*1024*1024;
const official=/^request\.official\.[a-f0-9]{64}$/u,sha=/^[a-f0-9]{64}$/u,sourceId=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const binaryHeaders={...headers,'Content-Security-Policy':"sandbox; default-src 'none'"};
const reject=(status,code)=>{throw Object.assign(Error(code),{status});};
const need=(ok,status,code)=>{if(!ok)reject(status,code);};
const digest=v=>typeof v==='string'&&sha.test(v);
const integers=(x,lo,hi)=>Number.isSafeInteger(x)&&x>=lo&&x<=hi;
const hash=async input=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input)),x=>x.toString(16).padStart(2,'0')).join('');
const encoder=new TextEncoder();
const decode=new TextDecoder('utf-8',{fatal:true});
const knownRoutes=new Set([project,icon,audio,concepts]);
const unavailable=()=>reject(503,'SPACE_REPLICA_VIEW_UNAVAILABLE');
const missingAudio=()=>reject(404,'AUDIO_RESULT_NOT_FOUND');
const exactKeys=(params,expected)=>[...params.keys()].sort().join(',')===expected;
const iconUrl=o=>icon+'?'+new URLSearchParams({projectId,sha256:o.customMetadata.sha256});
const json=(body,status=200)=>Response.json(body,{status,headers});
const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
const matches=(bytes,head,offset=0)=>head.every((v,i)=>bytes[offset+i]===v);
function proof(o,sha256,mimeSize){
 return o&&o.size===mimeSize&&o.customMetadata?.sha256===sha256&&typeof o.etag==='string';
}
async function recordObject(replica,path,maximum=metadataLimit){
 const info=await replica.head(path);
 if(!info)return null;
 if(!integers(info.size,2,maximum)||!digest(info.customMetadata?.sha256))unavailable();
 const file=await replica.get(path,{onlyIf:{etagMatches:info.etag}});
 if(!proof(file,info.customMetadata.sha256,info.size))unavailable();
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(bytes.byteLength!==file.size)unavailable();
 let result;try{result=JSON.parse(decode.decode(bytes));}catch{unavailable();}
 if(!result||typeof result!=='object'||Array.isArray(result))unavailable();
 return result;
}
async function projectRow(replica){
 const metadata=await recordObject(replica,'project.json');
 if(!metadata)return null;
 const label=[metadata.name,metadata.displayName,metadata.title].find(v=>typeof v==='string'&&v.trim())?.trim();
 const name=label&&label.isWellFormed()&&label.length<=120&&!/[\u0000-\u001f\u007f-\u009f]/u.test(label)?label:projectId;
 const art=await replica.head('icon.png');
 const safeArt=art&&integers(art.size,8,iconLimit)&&digest(art.customMetadata?.sha256);
 return {projectId,name,iconUrl:safeArt?iconUrl(art):null,needsRefresh:false};
}
async function projectIcon(request,replica,q){
 const sha256=q.get('sha256');
 need(exactKeys(q,'projectId,sha256')&&digest(sha256),400,'PROJECT_FOLDER_ICON_QUERY_INVALID');
 const meta=await replica.head('icon.png');
 need(meta?.customMetadata.sha256===sha256&&integers(meta.size,8,iconLimit),404,'PROJECT_FOLDER_ICON_NOT_FOUND');
 const responseHeaders={...binaryHeaders,'Content-Type':'image/png','Content-Length':String(meta.size)};
 if(request.method==='HEAD')return new Response(null,{headers:responseHeaders});
 const file=await replica.get('icon.png',{onlyIf:{etagMatches:meta.etag}});
 need(proof(file,sha256,meta.size),404,'PROJECT_FOLDER_ICON_NOT_FOUND');
 const body=new Uint8Array(await file.arrayBuffer());
 need(body.length===meta.size&&matches(body,signature),503,'SPACE_REPLICA_VIEW_UNAVAILABLE');
 return new Response(body,{headers:responseHeaders});
}
async function audioRecord(replica,id,wavSha){
 const folder='audio/'+id,wav=folder+'/audio.wav';
 const meta=await recordObject(replica,folder+'/metadata.json'),a=meta?.audio;
 if(meta?.schemaVersion!=='workflow.audio-result.v1'||meta.officialRequestId!==id||meta.projectId!==projectId||meta.kind!=='bgm'||
    typeof meta.taskId!=='string'||meta.taskId!=='workflow.task.'+await hash(encoder.encode(JSON.stringify([id,'audio_generate'])))||
    !digest(meta.payloadSha256)||typeof meta.conceptId!=='string'||!sourceId.test(meta.conceptId)||
    meta.source?.conceptId!==meta.conceptId||!digest(meta.source.sectionSha256)||
    typeof meta.title!=='string'||!meta.title.isWellFormed()||!meta.title.trim()||[...meta.title].length>120||
    a?.path!=='audio.wav'||a.mimeType!=='audio/wav'||!digest(a.sha256)||!integers(a.bytes,44,limit)||
    ![1,2].includes(a.channels)||a.bitsPerSample!==16||!integers(a.sampleRate,8000,96000)||
    !integers(a.frames,1,limit)||a.bytes!==44+a.frames*a.channels*2||a.durationSeconds!==a.frames/a.sampleRate||
    (wavSha!==undefined&&a.sha256!==wavSha))return null;
 return {meta,a,wav};
}
async function playlist(replica){
 const inventory=await replica.list();
 const ids=[],wave=new Map();
 for(const {path,sha256} of inventory){
  const parts=path.split('/');
  if(parts.length!==3||parts[0]!=='audio'||!official.test(parts[1]))continue;
  if(parts[2]==='metadata.json')ids.push(parts[1]);
  if(parts[2]==='audio.wav')wave.set(parts[1],sha256);
 }
 need(ids.length<=4096,503,'SPACE_REPLICA_VIEW_UNAVAILABLE');
 const rows=[];
 for(let idx=0;idx<ids.length;idx+=8){
  const records=await Promise.all(ids.slice(idx,idx+8).filter(id=>wave.has(id)).map(async id=>{
   try{return await audioRecord(replica,id,wave.get(id));}catch{return null;}
  }));
  rows.push(...records.filter(Boolean));
 }
 const when=r=>integers(r.meta.generatedAt,1,Number.MAX_SAFE_INTEGER)?r.meta.generatedAt:0;
 rows.sort((a,b)=>when(a)-when(b)||a.meta.officialRequestId.localeCompare(b.meta.officialRequestId));
 return {projectId,results:rows.map(({meta,a})=>{
  const bpm=meta.bpmBasis==='model'&&integers(meta.bpm,30,300)?meta.bpm:null;
  return {title:meta.title,bpm,bpmBasis:bpm===null?'unavailable':'model',durationSeconds:a.durationSeconds,
   url:audio+'?'+new URLSearchParams({projectId,id:meta.officialRequestId,sha256:a.sha256})};
 })};
}
async function soundConcepts(replica){
 const index=await recordObject(replica,'concept/metadata.json',2*1024*1024);
 if(!index)unavailable();
 const hierarchy=index.document?.hierarchy,ordered=index.sectionIds;
 if(hierarchy===undefined)return {concepts:[]};
 const groups=hierarchy?.groups,archives=hierarchy?.archivedCategoryIds??[];
 if(hierarchy?.schemaVersion!=='npc-concept-groups.v1'||!Array.isArray(groups)||!groups.length||groups.length>100||
    !Array.isArray(ordered)||ordered.some(id=>typeof id!=='string'||!sourceId.test(id))||
    new Set(ordered).size!==ordered.length||!Array.isArray(archives)||new Set(archives).size!==archives.length)unavailable();
 const ids=new Set(ordered),claimed=new Set(archives),groupIds=new Set();
 if(archives.some(id=>!ids.has(id)))unavailable();
 let sound=new Set();
 for(const group of groups){
  const {id,title,categoryIds}=group??{};
  if(typeof id!=='string'||!/^[A-Za-z0-9._:-]{1,180}$/u.test(id)||['__proto__','constructor','prototype'].includes(id)||
     groupIds.has(id)||typeof title!=='string'||!title.trim()||[...title].length>100||!Array.isArray(categoryIds))unavailable();
  groupIds.add(id);
  for(const category of categoryIds){
   if(!ids.has(category)||claimed.has(category))unavailable();
   claimed.add(category);
  }
  if(id==='group.sound')sound=new Set(categoryIds);
 }
 if(claimed.size!==ids.size)unavailable();
 const markdown=index._markdownSections;
 if(markdown!==undefined&&(!markdown||typeof markdown!=='object'||Array.isArray(markdown)))unavailable();
 const result=[];
 for(const id of ordered){
  if(!sound.has(id))continue;
  const folder='concept/sections/'+id;
  let title;
  if(markdown&&Object.hasOwn(markdown,id)){
   const row=markdown[id];
   if(!row||Object.keys(row).sort().join(',')!=='mode,priority,sha256,title'||!digest(row.sha256)||
      !Number.isSafeInteger(row.priority)||!['structured','authored'].includes(row.mode)||
      typeof row.title!=='string'||!row.title.trim())unavailable();
   const body=await replica.head(folder+'/content.md');
   if(body?.customMetadata?.sha256!==row.sha256||body.size===0)continue;
   title=row.title;
  }else{
   const row=await recordObject(replica,folder+'/metadata.json',2*1024*1024);
   if(row?.id!==id)continue;
   title=row.title;
  }
  const label=typeof title==='string'&&title.isWellFormed()&&title.trim()?title.trim():id;
  result.push({id,label});
 }
 return {concepts:result};
}
function rangeOf(value,size){
 const match=/^bytes=(\d{0,12})-(\d{0,12})$/u.exec(value);
 if(!match||!match[1]&&!match[2])return null;
 const end=!match[1]||!match[2]?size-1:Math.min(size-1,Number(match[2]));
 const start=!match[1]?Math.max(0,size-Number(match[2])):Number(match[1]);
 return start<=end?{start,end}:null;
}
async function audioFile(request,replica,q){
 const id=q.get('id'),sha256=q.get('sha256');
 need(exactKeys(q,'id,projectId,sha256')&&typeof id==='string'&&official.test(id)&&digest(sha256),400,'AUDIO_RESULT_INPUT_INVALID');
 const row=await audioRecord(replica,id,sha256);
 if(!row)missingAudio();
 const file=await replica.head(row.wav),size=row.a.bytes;
 if(!proof(file,sha256,size))missingAudio();
 const onlyIf={etagMatches:file.etag};
 const magic=await replica.get(row.wav,{onlyIf,range:{offset:0,length:12}});
 if(!proof(magic,sha256,size))missingAudio();
 const magicBytes=new Uint8Array(await magic.arrayBuffer());
 need(matches(magicBytes,[82,73,70,70])&&matches(magicBytes,[87,65,86,69],8),503,'SPACE_REPLICA_VIEW_UNAVAILABLE');
 const raw=request.headers.get('range');
 const range=raw===null?{start:0,end:size-1}:rangeOf(raw,size);
 const responseHeaders={...binaryHeaders,'Content-Type':'audio/wav','Accept-Ranges':'bytes'};
 if(!range)return new Response(null,{status:416,headers:{...responseHeaders,'Content-Range':'bytes */'+size}});
 const {start,end}=range,length=end-start+1;
 responseHeaders['Content-Length']=String(length);
 if(raw!==null)responseHeaders['Content-Range']=`bytes ${start}-${end}/${size}`;
 const status=raw===null?200:206;
 if(request.method==='HEAD')return new Response(null,{status,headers:responseHeaders});
 const part=await replica.get(row.wav,{onlyIf,...(raw===null?{}:{range:{offset:start,length}})});
 if(!proof(part,sha256,size)||!part.body)missingAudio();
 return new Response(part.body,{status,headers:responseHeaders});
}
/** Handle only this explicit GET/HEAD route set after existing native auth and Binari grant. */
export async function spaceReplicaView(request,replica,{authorize}={}){
 const url=new URL(request.url),path=url.pathname,q=url.searchParams;
 if(!knownRoutes.has(path))return null;
 try{
  const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
  need(userId&&email&&userId.length<=200&&email.length<=320,401,'SIGN_IN_REQUIRED');
  const origin=request.headers.get('origin');
  need((!origin||origin===url.origin)&&request.headers.get('sec-fetch-site')!=='cross-site',403,'ORIGIN_FORBIDDEN');
  need(await authorize({userId,email},projectId)===true,403,'PROJECT_OR_RESOURCE_DENIED');
  need(replica,503,'SPACE_REPLICA_VIEW_UNAVAILABLE');
  need(request.method==='GET'||request.method==='HEAD',405,'METHOD_NOT_ALLOWED');
  if(path===project){
   need(!url.search,400,'PROJECT_FOLDER_QUERY_INVALID');
   const row=await projectRow(replica);
   return request.method==='HEAD'?new Response(null,{headers}):json({projects:row?[row]:[]});
  }
  if(path===concepts){
   need(!url.search,400,'AUDIO_CONCEPT_QUERY_INVALID');
   return request.method==='HEAD'?new Response(null,{headers}):json(await soundConcepts(replica));
  }
  need(q.getAll('projectId').length===1&&q.get('projectId')===projectId,403,'PROJECT_OR_RESOURCE_DENIED');
  if(path===icon)return await projectIcon(request,replica,q);
  if(q.has('id'))return await audioFile(request,replica,q);
  need(exactKeys(q,'projectId'),400,'AUDIO_RESULT_INPUT_INVALID');
  if(!await replica.head('project.json'))unavailable();
  return request.method==='HEAD'?new Response(null,{headers}):json(await playlist(replica));
 }catch(e){
  const status=[400,401,403,404,405].includes(e?.status)?e.status:503;
  return json({error:status===503?'SPACE_REPLICA_VIEW_UNAVAILABLE':e.message},status);
 }
}
