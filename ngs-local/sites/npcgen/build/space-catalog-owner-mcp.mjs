import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import {join} from 'node:path';

const binary='/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const mcpTool='npcgen.npc_mirror_dispatch';
const defaultCwd=join(homedir(),'Workspaces','NGS');
const actions=new Set(['project-catalog-read-pending','project-catalog-read-reply']);
const error=()=>Error('SPACE_CATALOG_OWNER_MCP_UNAVAILABLE');

export function createCodexOwnerMCP({start=()=>spawn(binary,['app-server','--stdio'],{cwd:defaultCwd,stdio:['pipe','pipe','ignore']})}={}){
 let active,serial=Promise.resolve(),closed=false;
 function stop(){
  if(!active)return;
  const old=active;active=undefined;
  old.rejectCurrent?.();old.lines.close();old.child.stdin.end();old.child.kill('SIGTERM');
 }
 async function open(){
  const child=start(),lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  const current={child,lines,thread:null,next:0,rejectCurrent:undefined};
  active=current;
  child.on('error',()=>{if(active===current)stop();});
  child.stdin.on('error',()=>{if(active===current)stop();});
  child.on('close',()=>{if(active===current)stop();});
  const send=value=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
  current.rpc=(method,params)=>new Promise((resolve,reject)=>{
   const id=++current.next;
   const timeout=setTimeout(()=>fail(),40_000);
   const exit=()=>{clearTimeout(timeout);lines.off('line',line);current.rejectCurrent=undefined;};
   const fail=()=>{exit();reject(error());};
   current.rejectCurrent=fail;
   function line(raw){
    if(raw.length>512*1024){fail();return;}
    let value;try{value=JSON.parse(raw);}catch{fail();return;}
    // The adapter never supplies an approval, browser handoff, or user credential.
    if(value.method&&Object.hasOwn(value,'id')){fail();return;}
    if(value.id!==id)return;
    if(value.error||!value.result||typeof value.result!=='object'){fail();return;}
    exit();resolve(value.result);
   }
   lines.on('line',line);
   try{send({id,method,params});}catch{fail();}
  });
  await current.rpc('initialize',{clientInfo:{name:'ngs-space-catalog-owner',version:'1.0'}});
  send({method:'initialized'});
  const thread=await current.rpc('thread/start',{cwd:defaultCwd,ephemeral:true});
  if(typeof thread.thread?.id!=='string'||!thread.thread.id)throw error();
  current.thread=thread.thread.id;
  const owner=await current.rpc('mcpServerStatus/list',{threadId:current.thread,serverName:'codex_apps',detail:'full'});
  if(!JSON.stringify(owner).includes('"'+mcpTool+'"'))throw error();
  return current;
 }
 async function invoke(command){
  if(closed||!actions.has(command?.action))throw error();
  try{
   const conn=active??await open();
   const result=await conn.rpc('mcpServer/tool/call',{threadId:conn.thread,server:'codex_apps',tool:mcpTool,arguments:{command}});
   if(result.isError===true||!result.structuredContent||typeof result.structuredContent!=='object'||Array.isArray(result.structuredContent))throw error();
   return result.structuredContent;
  }catch{stop();throw error();}
 }
 function callSite(command){
  const seed=serial;
  const promise=seed.then(()=>invoke(command));
  serial=promise.catch(()=>{});
  return promise;
 }
 return {callSite,close(){closed=true;stop();}};
}
