/** Opt-in native composition: preserve the exact Mac browser and MCP listeners. */
import {pathToFileURL} from 'node:url';
import {createLocalProjectPageServer,configuration} from './local-project-page-server.mjs';
import {createLocalRequestQueueMcp} from './local-request-queue-mcp.mjs';
import {LOCAL_QUEUE_MCP_DEFAULT_PORT,openLocalRequestQueue} from './local-request-queue.mjs';
import {openLocalMiniflareReplica} from './local-miniflare-runtime.mjs';

const fail=()=>Error('LOCAL_MINIFLARE_NGS_CONFIGURATION_INVALID');
function bind(server,port){
 return new Promise((resolve,reject)=>{
  function error(e){reject(e);}
  server.once('error',error);
  server.listen(port,'127.0.0.1',()=>{
   server.removeListener('error',error);resolve(server.address().port);
  });
 });
}
const stop=async server=>{
 if(server?.listening)await new Promise(resolve=>server.close(resolve));
};

export async function startLocalMiniflareNgs({env=process.env,fixture=false,load,browserPort,receiverPort}={}){
 if(env.NGS_FILE_SYNC_MODE!=='push'||env.NGS_FILE_SYNC_PROJECTS!=='binari'||!env.NGS_REQUEST_QUEUE_DB)throw fail();
 const config=configuration(env),webPort=browserPort??config.port;
 const mcpPort=receiverPort??Number(env.NGS_REQUEST_QUEUE_MCP_PORT??LOCAL_QUEUE_MCP_DEFAULT_PORT);
 if([webPort,mcpPort].some(port=>!Number.isInteger(port)||port<(fixture?0:1)||port>65535)||
   !fixture&&(webPort!==5274||mcpPort!==5275)||webPort!==0&&webPort===mcpPort)throw fail();
 const storage=await openLocalMiniflareReplica({persistRoot:env.NGS_LOCAL_MINIFLARE_ROOT,fixture,load});
 let queue,web,mcp,closed;
 const close=()=>closed??=(async()=>{
  await Promise.all([stop(web),stop(mcp)]);
  try{queue?.close();}finally{await storage.close();}
 })();
 try{
  queue=openLocalRequestQueue(env.NGS_REQUEST_QUEUE_DB);
  web=createLocalProjectPageServer({...config,requestQueue:queue,objectReplica:storage.replica});
  mcp=createLocalRequestQueueMcp(queue,{fileSync:storage.replica,fileSyncToolDefinitions:storage.fileSyncToolDefinitions});
  const mcpBound=await bind(mcp,mcpPort),webBound=await bind(web,webPort);
  return {ports:{web:webBound,mcp:mcpBound},close};
 }catch(e){await close();throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let running;
 try{
  running=await startLocalMiniflareNgs();
  console.log('LOCAL_MINIFLARE_NGS_READY');
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>void running.close().catch(()=>{process.exitCode=1;}));
 }catch{console.error('LOCAL_MINIFLARE_NGS_START_FAILED');process.exitCode=1;}
}
