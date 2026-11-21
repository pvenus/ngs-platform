/** Mac-only owner relay for the one public-in-Site catalog summary, from fresh local PDS. */
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createFolderMcpClient} from './folder-mcp-client.mjs';
import {loopbackFolderMCP} from './folder-mcp-loopback.mjs';
import {validateProjectFolderFile,validProjectId} from './local-project-folders.mjs';
import {createCodexOwnerMCP} from './space-catalog-owner-mcp.mjs';

const projectId='binari',maxBytes=64*1024,maxPending=16;
const nameOK=v=>typeof v==='string'&&v===v.trim()&&v.isWellFormed()&&[...v].length>0&&[...v].length<=120&&!/[\x00-\x1f\x7f]/u.test(v);
const hash=v=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/.test(v);
const reqId=v=>typeof v==='string'&&v.length===50&&/^space\.catalog\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const exact=(v,k)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const fail=()=>Error('SPACE_CATALOG_SOURCE_UNAVAILABLE');

export async function readBinariCatalog(pds=createFolderMcpClient({call:loopbackFolderMCP()})){
 const list=await pds.discover();
 if(!exact(list,['projects'])||!Array.isArray(list.projects)||list.projects.some(v=>!validProjectId(v))||
  new Set(list.projects).size!==list.projects.length)throw fail();
 if(!list.projects.includes(projectId))return {projects:[]};
 const inventory=await pds.compare(projectId,[]);
 if(!exact(inventory,['scope','groups'])||inventory.scope!==projectId||!Array.isArray(inventory.groups))throw fail();
 const roots=inventory.groups.filter(row=>row?.folder==='');
 if(roots.length!==1||!exact(roots[0],['folder','files'])||!Array.isArray(roots[0].files))throw fail();
 const records=roots[0].files.filter(row=>row?.path==='project.json');
 if(records.length!==1||!exact(records[0],['path','sha256','size'])||!hash(records[0].sha256)||
  !Number.isSafeInteger(records[0].size)||records[0].size<1||records[0].size>maxBytes)throw fail();
 const pin=records[0];
 const file=pds.file(projectId,pin.path,pin.sha256,pin.size);
 const content=Buffer.from(await new Response(file.body).arrayBuffer());
 if(content.length!==pin.size||createHash('sha256').update(content).digest('hex')!==pin.sha256)throw fail();
 const metadata=validateProjectFolderFile(pin.path,content);
 const name=[metadata.name,metadata.displayName,metadata.title].find(v=>typeof v==='string'&&v.trim())?.trim()??projectId;
 if(!nameOK(name))throw fail();
 return {projects:[{projectId,name,iconUrl:null,needsRefresh:false}]};
}

export function createSpaceCatalogWorker({ownerCall,pds}){
 if(typeof ownerCall!=='function')throw fail();
 async function pending(){
  const response=await ownerCall({action:'project-catalog-read-pending'});
  if(!exact(response,['requests'])||!Array.isArray(response.requests)||response.requests.length>maxPending||
   response.requests.some(x=>!exact(x,['requestId'])||!reqId(x.requestId))||
   new Set(response.requests.map(x=>x.requestId)).size!==response.requests.length)throw fail();
  return response.requests;
 }
 return {
  async readiness(){return {pending:(await pending()).length,projects:(await readBinariCatalog(pds)).projects.length};},
  async pollOnce(){
   const requests=await pending();
   if(!requests.length)return {delivered:0,pending:0};
   const result=await readBinariCatalog(pds); // Once for only this unexpired batch; never cached.
   let delivered=0;
   for(const {requestId} of requests){
    try{
     const ack=await ownerCall({action:'project-catalog-read-reply',requestId,result});
     if(exact(ack,['requestId','status'])&&ack.requestId===requestId&&ack.status==='delivered')delivered++;
    }catch{/* Never mark an unverified reply delivered. Site expiry governs next poll. */}
   }
   return {delivered,pending:requests.length-delivered};
  },
 };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const mode=process.argv.length===3?process.argv[2]:null;
 if(!['--readiness','--watch'].includes(mode)){
  console.error('SPACE_CATALOG_WORKER_EXPLICIT_MODE_REQUIRED');
  process.exitCode=2;
 }else{
  const owner=createCodexOwnerMCP(),worker=createSpaceCatalogWorker({ownerCall:owner.callSite});
  let stop=false,timer,release;
  const close=()=>{stop=true;clearTimeout(timer);release?.();owner.close();};
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,close);
  try{
   if(mode==='--readiness'){
    const result=await worker.readiness();
    console.log('SPACE_CATALOG_READY',result.projects);
   }else{
    while(!stop){
     try{
      const result=await worker.pollOnce();
      if(result.delivered||result.pending)console.log('SPACE_CATALOG_POLL',result.delivered,result.pending);
     }catch{if(!stop)console.error('SPACE_CATALOG_SOURCE_UNAVAILABLE');}
     if(!stop)await new Promise(ok=>{release=ok;timer=setTimeout(ok,2500);});
    }
   }
  }catch{
   console.error('SPACE_CATALOG_SOURCE_UNAVAILABLE');
   process.exitCode=1;
  }finally{close();}
 }
}
