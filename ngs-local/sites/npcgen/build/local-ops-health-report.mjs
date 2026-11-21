import {loopbackJsonMCP} from './folder-mcp-loopback.mjs';

export const OPS_HEALTH_MCP_URL='http://127.0.0.1:8090/mcp';

export function startOpsHealthReport({
 url=OPS_HEALTH_MCP_URL,
 serverName,
 schedule=setInterval,
 unschedule=clearInterval,
}={}){
 const controller=new AbortController();
 const call=loopbackJsonMCP(url,{clientName:'ngs-ops-health',timeoutMs:8_000,signal:controller.signal,
  transportError:()=>Error('OPS_HEALTH_MCP_UNAVAILABLE')});
 let running=false,stopped=false;
 async function tick(){
  if(stopped||running)return;
  running=true;
  try{await call('ops_service_health_report',{serverName},{limit:8*1024});}
  catch{/* OPS reporting never prevents NGS from serving requests. Retry at the next interval. */}
  finally{running=false;}
 }
 const timer=schedule(tick,60_000);
 timer?.unref?.();
 void tick();
 return {stop(){if(stopped)return;stopped=true;unschedule(timer);controller.abort();}};
}
