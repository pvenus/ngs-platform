import handler from "vinext/server/fetch-handler";
import { sharedNgsResponse } from "./shared-ngs-assets";
import { replicaSyncProgressPath,readReplicaSyncProgress } from "../ngs-local/sites/npcgen/build/replica-sync-progress.mjs";
import { projectCatalogResponse, projectCatalogMcp } from "./space-project-catalog.mjs";
import { appProject, siteAppMaster } from "../lib/app-master";
import { masterPrincipal } from "../lib/master-concept-transport";
import { spaceReplicaView } from "./space-replica-view.mjs";
import { spaceWorkspaceReadResponse } from "./space-workspace-read-response.mjs";
import { PromptService } from "../lib/prompt-service";
import { createSpaceFileReplica, spaceFileSyncTools } from "./space-file-replica.mjs";
import { browserQueueResponse, machineResponse, machineTokenConfigured } from "./space-machine-routes.mjs";
import { rejectCleanSpaceRequest } from "./clean-space-guard.mjs";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    if (env.NPCGEN_SPACE_MAINTENANCE === "1") {
      const headers = { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" };
      return new Response(request.method === "HEAD" ? null :
        '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NGS 점검 중</title><main><h1>NGS 점검 중</h1><p>파일 동기화 성능을 개선하고 있습니다.</p></main></html>',
        { status: 503, headers });
    }
    const db = env.DB;
    const secret = env.NPCGEN_SPACE_MACHINE_TOKEN;
    const authorize = async (user:{userId:string}) => {
      if (!db) throw Object.assign(Error("SPACE_PROJECT_CATALOG_UNAVAILABLE"),{status:503});
      const grant = await appProject(db, siteAppMaster(user), "binari");
      return grant.project_id === "binari" && grant.revoked === 0;
    };
    const fileReplica = db && env.BUCKET ? createSpaceFileReplica({db,bucket:env.BUCKET,cacheOrigin:new URL(request.url).origin}) : undefined;
    const replicaReads = env.NPCGEN_SPACE_REPLICA_READ_ENABLED === "1" && !!fileReplica && machineTokenConfigured(secret);
    if (new URL(request.url).pathname === replicaSyncProgressPath) {
      const headers = {"cache-control":"private, no-store","x-content-type-options":"nosniff"};
      const userId=request.headers.get("oai-authenticated-user-id"),email=request.headers.get("oai-authenticated-user-email");
      if (!userId||!email||userId.length>200||email.length>320) return Response.json({error:"SIGN_IN_REQUIRED"},{status:401,headers});
      const url=new URL(request.url),origin=request.headers.get("Origin");
      if (origin&&origin!==url.origin||request.headers.get("Sec-Fetch-Site")==="cross-site")
        return Response.json({error:"ORIGIN_FORBIDDEN"},{status:403,headers});
      try {
        const value=await readReplicaSyncProgress({method:request.method,query:url.searchParams,
          authorize:()=>authorize({userId}),read:replicaReads?fileReplica?.progress:undefined});
        return Response.json(value,{headers});
      } catch (error: unknown) {
        const cause=(error&&typeof error==='object'?error:{}) as {status?:number;message?:string};
        const status=cause.status&&[400,403,405].includes(cause.status)?cause.status:503;
        return Response.json({error:status===503?"NGS_SYNC_PROGRESS_UNAVAILABLE":cause.message},{status,headers});
      }
    }
    const machine = await machineResponse(request,{db,secret,fileReplica,fileTools:spaceFileSyncTools});
    if (machine) return machine;
    const browserQueue = await browserQueueResponse(request,{db,secret,authorize,replicaReads,workspaceReady:replicaReads,authorizeWrite:async user=>{
      try { const grant=await masterPrincipal(user); return grant.role==="owner" && grant.projectId==="binari"; }
      catch { return false; }
    }});
    if (browserQueue) return browserQueue;
    if (replicaReads) {
      const workspace = await spaceWorkspaceReadResponse(request,fileReplica,{authorize:async (user,projectId,resource)=>{
        if (projectId !== "binari" || !await authorize(user)) return false;
        if(!resource) return false;
        try {
          await new PromptService(db!,user.userId,undefined,siteAppMaster(user)).resourcePolicy(projectId,resource);
          return true;
        } catch { return false; }
      }});
      if(workspace) return workspace;
      const view = await spaceReplicaView(request,fileReplica,{authorize:async (user,projectId)=>{
        if (projectId !== "binari" || !await authorize(user)) return false;
        if (new URL(request.url).pathname === "/api/space/audio-concepts") {
          try { await new PromptService(db!,user.userId,undefined,siteAppMaster(user)).resourcePolicy("binari","concept"); }
          catch { return false; }
        }
        return true;
      }});
      if (view) return view;
    }
    const shared = sharedNgsResponse(request, {catalogRelay:true});
    if (shared) return shared;
    const catalog = await projectCatalogResponse(request, db, {authorize});
    if (catalog) return catalog;
    const denied = await rejectCleanSpaceRequest(request,{catalogCall:(req:Request,message:unknown)=>
      projectCatalogMcp(req,message,db,{authorizeOwner:async (user:{userId:string,email:string}) => {
        try { const p=await masterPrincipal(user); return p.role==="owner" && p.projectId==="binari"; }
        catch { return false; }
      }})});
    if (denied) return denied;
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};
