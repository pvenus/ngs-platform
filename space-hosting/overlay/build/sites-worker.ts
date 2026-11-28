import handler from "vinext/server/fetch-handler";
import { sharedNgsResponse } from "./shared-ngs-assets";
import { appendViewerDiscovery, spaceViewerMcpResponse } from "./space-viewer-mcp.mjs";
import { spaceViewerResponse } from "./space-viewer-export.mjs";
import { spaceViewerInstallResponse } from "./space-viewer-install.mjs";
import viewerBridgeScript from "./space-viewer-bridge.mjs?raw";
import { admitSpaceMapAssembly } from "./space-map-assembly.mjs";
import { replicaSyncProgressPath,readReplicaSyncProgress } from "../ngs-local/sites/npcgen/build/replica-sync-progress.mjs";
import { projectCatalogResponse, projectCatalogMcp } from "./space-project-catalog.mjs";
import { appProject, siteAppMaster } from "../lib/app-master";
import { masterPrincipal } from "../lib/master-concept-transport";
import workspaceRoster from "../lib/master-concept-participants.json";
import { objectAudioSeparationSource } from "../ngs-local/sites/npcgen/build/object-replica-view.mjs";
import { spaceReplicaView } from "./space-replica-view.mjs";
import { dispatchWorkspaceRead } from "../ngs-local/sites/npcgen/build/workspace-read-registry.mjs";
import { propEnabledActions } from "../ngs-local/sites/npcgen/build/prop-workspace-contract.mjs";
import { admitCinematicRequest } from "../ngs-local/sites/npcgen/build/cinematic-workspace.mjs";
import { admitPropRequest, admitPropAnimationRemove } from "../ngs-local/sites/npcgen/build/prop-workspace.mjs";
import { openSpaceWorkspaceProject } from "./space-workspace-read-storage.mjs";
import { spaceWorkspaceReadResponse } from "./space-workspace-read-response.mjs";
import { PromptService } from "../lib/prompt-service";
import { createSpaceFileReplica, spaceFileSyncTools } from "./space-file-replica.mjs";
import { authorizeSpaceQueueWrite, spaceQueueParticipant, spaceWorkspacePrincipal, browserQueueResponse, machineResponse, machineTokenConfigured } from "./space-machine-routes.mjs";
import { ngsCommitSha } from "./ngs-release-provenance.mjs";
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
    const machine = await machineResponse(request,{db,secret,fileReplica,fileTools:spaceFileSyncTools,commitSha:ngsCommitSha});
    if (machine) return machine;
    const editorHashes=(workspaceRoster as {workspaceEditorHashes?: string[]}).workspaceEditorHashes;
    const workspacePrincipal = (user:{userId:string,email:string})=>spaceWorkspacePrincipal(user,editorHashes,masterPrincipal);
    // This is the project workspace grant, not the generic queue-only exception.
    const mapAssemblyGrant = async (user:{userId:string,email:string}) => {
      try {
        const grant=await workspacePrincipal(user);
        return spaceQueueParticipant(grant)?grant:null;
      } catch { return null; }
    };
    const workspaceAuthorize = async (user:{userId:string,email:string},projectId:string,resource:string|undefined) => {
      if (projectId !== "binari" || !await authorize(user) || !resource) return false;
      try {
        // The new prop folder is not a legacy PromptService logical resource.
        // Only the existing active Binari participant roster can read it.
        // In particular, a queue-only additional email is not a prop grant.
        if(resource==="props"||resource==="cinematics"||resource==="assembly")return !!await mapAssemblyGrant(user);
        await new PromptService(db!,user.userId,undefined,siteAppMaster(user)).resourcePolicy(projectId,resource);
        return true;
      } catch { return false; }
    };
    const authorizeViewerParticipant=async (user:{userId:string,email:string})=>await authorize(user)&&!!await mapAssemblyGrant(user);
    const viewerInstall=await spaceViewerInstallResponse(request,{secret,signingKey:
      (env as Cloudflare.Env & {NPCGEN_VIEWER_INSTALL_SIGNING_KEY?:string}).NPCGEN_VIEWER_INSTALL_SIGNING_KEY,
      authorizeParticipant:authorizeViewerParticipant});
    if(viewerInstall)return viewerInstall;
    const viewerOptions={replica:replicaReads?fileReplica:undefined,bridgeScript:viewerBridgeScript,
      authorizeParticipant:authorizeViewerParticipant,authorizeResource:workspaceAuthorize};
    const viewerMcp=await spaceViewerMcpResponse(request,viewerOptions);
    if(viewerMcp)return viewerMcp;
    const viewer=await spaceViewerResponse(request,viewerOptions);
    if(viewer)return viewer;
    const hasPublishedNpc = replicaReads ? async (user:{userId:string,email:string},npcId:string) => {
      // The hosted queue must prove the same exact ID from the existing
      // authenticated roster, never trust an ID or alias from the browser.
      const {json:result} = await dispatchWorkspaceRead({
        pathname:"/api/npc-workspace",query:new URLSearchParams({projectId:"binari"}),
        openProject:projectId=>openSpaceWorkspaceProject(fileReplica,projectId),
        authorize:async projectId=>{
          if (!await workspaceAuthorize(user,projectId,"npcs"))
            throw Object.assign(Error("PROJECT_OR_RESOURCE_DENIED"),{status:403});
        },
      });
      if (!Array.isArray(result?.npcs)) throw Object.assign(Error("SPACE_NPC_REPLICA_UNAVAILABLE"),{status:503});
      return result.npcs.some((npc:{id:string})=>npc.id===npcId);
    } : undefined;
    const browserQueue = await browserQueueResponse(request,{db,secret,authorize,replicaReads,workspaceReady:replicaReads,hasPublishedNpc,
      mapAssemblyGrant,
      admitMapAssembly:replicaReads?async (user,command)=>admitSpaceMapAssembly({
        command,read:async (pathname,query)=>{
          const {json}=await dispatchWorkspaceRead({pathname,query,
            openProject:projectId=>openSpaceWorkspaceProject(fileReplica!,projectId),
            authorize:async projectId=>{
              const resource=pathname==="/api/assembly-workspace"?"assembly":"cinematics";
              if(!await workspaceAuthorize(user,projectId,resource))
                throw Object.assign(Error("PROJECT_OR_RESOURCE_DENIED"),{status:403});
            },
          });
          return json;
        },
      }):undefined,
      cinematicEnabled:(env as Cloudflare.Env & {NGS_CINEMATIC_ENABLED?:string}).NGS_CINEMATIC_ENABLED==="1",
      cinematicSequenceEnabled:(env as Cloudflare.Env & {NGS_CINEMATIC_SEQUENCE_ENABLED?:string}).NGS_CINEMATIC_SEQUENCE_ENABLED==="1",
      cinematicPlaybackEnabled:(env as Cloudflare.Env & {NGS_CINEMATIC_PLAYBACK_ENABLED?:string}).NGS_CINEMATIC_PLAYBACK_ENABLED==="1",
      backgroundSourceEnabled:(env as Cloudflare.Env & {NGS_BACKGROUND_SOURCE_ENABLED?:string}).NGS_BACKGROUND_SOURCE_ENABLED==="1",
      cinematicSourceEnabled:(env as Cloudflare.Env & {NGS_CINEMATIC_SOURCE_ENABLED?:string}).NGS_CINEMATIC_SOURCE_ENABLED==="1",
      cinematicRemoveEnabled:(env as Cloudflare.Env & {NGS_CINEMATIC_REMOVE_ENABLED?:string}).NGS_CINEMATIC_REMOVE_ENABLED==="1",
      propAnimationRemoveEnabled:(env as Cloudflare.Env & {NGS_PROP_ANIMATION_REMOVE_ENABLED?:string}).NGS_PROP_ANIMATION_REMOVE_ENABLED==="1",
      admitPropAnimationRemove:replicaReads?async (user,command)=>admitPropAnimationRemove({
        openProject:projectId=>openSpaceWorkspaceProject(fileReplica!,projectId),command,
        authorize:async (projectId,resource)=>{
          if(!await workspaceAuthorize(user,projectId,resource))
            throw Object.assign(Error("PROJECT_OR_RESOURCE_DENIED"),{status:403});
        },
      }):undefined,
      admitCinematic:replicaReads?async (user,command)=>admitCinematicRequest({
        openProject:projectId=>openSpaceWorkspaceProject(fileReplica!,projectId),command,
        authorize:async (projectId,resource)=>{
          if(!await workspaceAuthorize(user,projectId,resource))
            throw Object.assign(Error("PROJECT_OR_RESOURCE_DENIED"),{status:403});
        },
      }):undefined,
      propActions:propEnabledActions(env),
      admitProp:replicaReads?async (user,command,actions)=>admitPropRequest({
        openProject:projectId=>openSpaceWorkspaceProject(fileReplica!,projectId),command,actions,
        authorize:async (projectId,resource)=>{
          if(!await workspaceAuthorize(user,projectId,resource))
            throw Object.assign(Error("PROJECT_OR_RESOURCE_DENIED"),{status:403});
        },
      }):undefined,
      npcBasicPortraitEnabled:(env as Cloudflare.Env & {NGS_NPC_BASIC_PORTRAIT_ENABLED?:string}).NGS_NPC_BASIC_PORTRAIT_ENABLED!=="0",
      poseSelectionV2Enabled:(env as Cloudflare.Env & {NGS_POSE_SELECTION_V2_ENABLED?:string}).NGS_POSE_SELECTION_V2_ENABLED==="1",
      hasAudioSeparationSource:replicaReads&&env.NPCGEN_AUDIO_SEPARATION_ENABLED==="1"
        ?payload=>objectAudioSeparationSource(fileReplica!,payload):undefined,
      // A trusted roster entry or the single configured exception is required in
      // addition to Sites authentication/admission and the active Binari grant.
      authorizeWrite:user=>authorizeSpaceQueueWrite(user,workspacePrincipal,env.NPCGEN_SPACE_QUEUE_EXTRA_EMAIL_SHA256),
    });
    if (browserQueue) return browserQueue;
    if (replicaReads) {
      const workspace = await spaceWorkspaceReadResponse(request,fileReplica,{authorize:workspaceAuthorize});
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
    if (denied) return appendViewerDiscovery(request,denied);
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
