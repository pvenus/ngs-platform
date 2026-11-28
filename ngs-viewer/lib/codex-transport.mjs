/** Viewer owns only its proxy child. Codex owns login, tool invocation and refresh. */
import {spawn} from 'node:child_process';

const failed=()=>Object.assign(Error('VIEWER_CODEX_CONNECTION_REQUIRED'),{status:503});
const maxLine=24*1024*1024,deadline=60_000;
const names=new Set(['ngs_viewer_manifest','ngs_viewer_file_chunk']);
export function codexViewerClient({binary,server,socket,spawnChild=spawn}){
 if(typeof binary!=='string'||!binary||typeof server!=='string'||!/^[a-z0-9_.-]{1,160}$/iu.test(server))
  throw Error('VIEWER_CODEX_CONFIGURATION');
 let current=null,next=0;
 const stop=state=>{
  if(state.closed)return;
  state.closed=true;
  if(current===state)current=null;
  for(const p of state.pending.values())p.finish(failed());
  state.child.stdin.destroy();
  state.child.kill(); // never terminates Codex or an existing agent thread
 };
 function get(){
  if(current)return current;
  const child=spawnChild(binary,['app-server','proxy',...(socket?['--sock',socket]:[])],
   {stdio:['pipe','pipe','ignore'],windowsHide:true});
  const state={child,pending:new Map(),buffer:Buffer.alloc(0),closed:false,ready:null};
  current=state;
  child.once('error',()=>stop(state));child.once('exit',()=>stop(state));
  child.stdin.on('error',()=>stop(state));child.stdout.on('error',()=>stop(state));
  child.stdout.on('data',data=>{
   if(state.closed)return;
   state.buffer=Buffer.concat([state.buffer,data]);
   if(state.buffer.length>maxLine){stop(state);return;}
   let end;
   while((end=state.buffer.indexOf(10))>=0){
    const line=state.buffer.subarray(0,end);state.buffer=state.buffer.subarray(end+1);
    try{
     const r=JSON.parse(line.toString('utf8'));
     // Refuse server-initiated operations; no prompts, sampling, or approvals.
     if(typeof r.method==='string'){
      if(Object.hasOwn(r,'id'))child.stdin.write(JSON.stringify({id:r.id,error:{code:-32601,message:'Viewer does not support interactive RPC'}})+'\n');
      continue;
     }
     const p=state.pending.get(r.id);
     if(p)p.finish(r.error?failed():null,r.result);
    }catch{stop(state);return;}
   }
  });
  state.ready=(async()=>{
   await rpc(state,'initialize',{clientInfo:{name:'ngs_viewer',version:'0.1.0'},capabilities:{experimentalApi:true}});
   child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
   const opened=await rpc(state,'thread/start',{ephemeral:true,sandbox:'read-only',approvalPolicy:'never'});
   const id=opened?.thread?.id;
   if(typeof id!=='string'||!id||id.length>160)throw failed();
   return id;
  })().catch(e=>{stop(state);throw e;});
  return state;
 }
 function rpc(state,method,params,signal){
  if(state.closed||signal?.aborted)return Promise.reject(signal?.reason??failed());
  const id=++next;
  return new Promise((resolve,reject)=>{
   const abort=()=>finish(signal.reason??failed());
   const expire=setTimeout(()=>{finish(failed());stop(state);},deadline);expire.unref?.();
   const finish=(error,result)=>{
    clearTimeout(expire);signal?.removeEventListener('abort',abort);state.pending.delete(id);
    if(error)reject(error);else resolve(result);
   };
   state.pending.set(id,{finish});
   signal?.addEventListener('abort',abort,{once:true});
   try{state.child.stdin.write(JSON.stringify({id,method,params})+'\n');}catch{finish(failed());stop(state);}
  });
 }
 async function tool(name,args,{signal}={}){
  if(!names.has(name))throw Error('VIEWER_CODEX_TOOL_DENIED');
  signal?.throwIfAborted();
  const state=get(),threadId=await state.ready;
  return rpc(state,'mcpServer/tool/call',{server,threadId,tool:name,arguments:args},signal);
 }
 return {tool,close:()=>{if(current)stop(current);}};
}
