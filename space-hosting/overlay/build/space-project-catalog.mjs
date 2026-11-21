/** Ephemeral delivery of the one already-authorized Binari project listing. */
const table='ngs_ephemeral_project_catalog_v1';
const ttl=60_000;
const queue=/^space\.catalog\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export const catalogActions=new Set(['project-catalog-read-pending','project-catalog-read-reply']);
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const reply=(status,body)=>Response.json(body,{status,headers});
const error=(status,code)=>Object.assign(Error(code),{status});
const need=(condition,status=400,code='SPACE_PROJECT_CATALOG_INVALID')=>{if(!condition)throw error(status,code);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const ticket=v=>typeof v==='string'&&v.length===50&&queue.test(v);
const actor=req=>{
 const userId=req.headers.get('oai-authenticated-user-id'),email=req.headers.get('oai-authenticated-user-email');
 return userId&&email&&userId.length<=200&&email.length<=320?{userId,email}:null;
};
function normalized(result){
 need(exact(result,['projects'])&&Array.isArray(result.projects)&&result.projects.length<=1);
 return {projects:result.projects.map(p=>{
  need(exact(p,['projectId','name','iconUrl','needsRefresh'])&&p.projectId==='binari'&&p.iconUrl===null&&p.needsRefresh===false&&
    typeof p.name==='string'&&p.name.isWellFormed()&&p.name.trim()===p.name&&p.name.length>=1&&p.name.length<=120&&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(p.name));
  return {projectId:'binari',name:p.name,iconUrl:null,needsRefresh:false};
 })};
}

export class SpaceProjectCatalog {
 constructor(db,{now=Date.now,uuid=()=>crypto.randomUUID()}={}){this.db=db;this.now=now;this.uuid=uuid;}
 async assertReady(){
  need(this.db,503,'SPACE_PROJECT_CATALOG_UNAVAILABLE');
  const schema=await this.db.prepare("SELECT 1 AS ready FROM sqlite_schema WHERE type='table' AND name=?").bind(table).first();
  need(schema?.ready===1,503,'SPACE_PROJECT_CATALOG_UNAVAILABLE');
 }
 async collect(now){
  await this.db.prepare(`DELETE FROM ${table} WHERE expiry<=?`).bind(now).run();
 }
 async put(id){
  await this.assertReady();
  const now=this.now();await this.collect(now);
  const requestId='space.catalog.'+this.uuid();
  need(ticket(requestId),503,'SPACE_PROJECT_CATALOG_UNAVAILABLE');
  await this.db.prepare(`INSERT INTO ${table}(actor_id,request_id,expiry,result) VALUES(?,?,?,NULL)
    ON CONFLICT(actor_id) DO NOTHING`).bind(id,requestId,now+ttl).run();
  const row=await this.db.prepare(`SELECT request_id,result FROM ${table} WHERE actor_id=? AND expiry>?`).bind(id,now).first();
  need(row,503,'SPACE_PROJECT_CATALOG_UNAVAILABLE');
  return this.view(row);
 }
 async get(id,requestId){
  need(ticket(requestId));
  await this.assertReady();
  const now=this.now();await this.collect(now);
  const row=await this.db.prepare(`SELECT request_id,result FROM ${table} WHERE actor_id=? AND request_id=? AND expiry>?`).bind(id,requestId,now).first();
  need(row,404,'SPACE_PROJECT_CATALOG_EXPIRED');
  return this.view(row);
 }
 view(row){
  const requestId=row.request_id;
  if(row.result===null)return {requestId,status:'pending'};
  return {requestId,status:'ready',...normalized(JSON.parse(row.result))};
 }
 async pending(){
  await this.assertReady();
  const now=this.now();await this.collect(now);
  const rows=(await this.db.prepare(`SELECT request_id FROM ${table} WHERE expiry>? AND result IS NULL ORDER BY expiry,request_id LIMIT 16`).bind(now).all()).results;
  return {requests:rows.map(r=>{need(ticket(r.request_id),503,'SPACE_PROJECT_CATALOG_UNAVAILABLE');return {requestId:r.request_id};})};
 }
 async settle(requestId,value){
  need(ticket(requestId));const outcome=JSON.stringify(normalized(value));
  await this.assertReady();
  const now=this.now();await this.collect(now);
  await this.db.prepare(`UPDATE ${table} SET result=? WHERE request_id=? AND expiry>? AND result IS NULL`).bind(outcome,requestId,now).run();
  const row=await this.db.prepare(`SELECT result FROM ${table} WHERE request_id=? AND expiry>?`).bind(requestId,now).first();
  need(row,404,'SPACE_PROJECT_CATALOG_EXPIRED');
  need(row.result===outcome,409,'SPACE_PROJECT_CATALOG_RECEIPT_CONFLICT');
  return {requestId,status:'delivered'};
 }
}
const handling=new Set(['/__npcgen_session','/api/space/project-catalog']);
export async function projectCatalogResponse(request,db,{authorize}){
 const url=new URL(request.url),path=url.pathname;
 if(!handling.has(path))return null;
 const user=actor(request);
 if(!user)return reply(401,{error:'SIGN_IN_REQUIRED'});
 try{
  need(await authorize(user)===true,403,'PROJECT_OR_RESOURCE_DENIED');
  if(path==='/__npcgen_session'){
   need(request.method==='GET'&&!url.search,405,'METHOD_NOT_ALLOWED');
   return reply(200,{state:'authenticated',backend:'space',readOnly:true});
  }
  const service=new SpaceProjectCatalog(db);
  let value;
  if(request.method==='POST'){
   need(!url.search&&request.headers.get('origin')===url.origin,403,'ORIGIN_FORBIDDEN');
   need(/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||''));
   const stream=request.body?.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let json='',length=0;
   need(stream);
   try{while(true){const item=await stream.read();if(item.done)break;length+=item.value.length;need(length<=32);json+=decoder.decode(item.value,{stream:true});}
    const args=JSON.parse(json+decoder.decode());need(exact(args,[]));
   }catch{throw error(400,'SPACE_PROJECT_CATALOG_INVALID');}
   finally{void stream.cancel().catch(()=>{});}
   value=await service.put(user.userId);
  }else if(request.method==='GET'){
   const q=url.searchParams.getAll('requestId');need(q.length===1&&[...url.searchParams.keys()].length===1);
   value=await service.get(user.userId,q[0]);
  }else throw error(405,'METHOD_NOT_ALLOWED');
  return reply(value.status==='ready'?200:202,value);
 }catch(e){const status=[400,403,404,405].includes(e?.status)?e.status:503;
  return reply(status,{error:status===503?'SPACE_PROJECT_CATALOG_UNAVAILABLE':e.message});
 }
}

export async function projectCatalogMcp(request,message,db,{authorizeOwner}){
 const user=actor(request),command=message?.params?.arguments?.command;
 try{
  need(user,401,'SIGN_IN_REQUIRED');
  need(!request.headers.has('origin')&&await authorizeOwner(user)===true,403,'SPACE_PROJECT_CATALOG_OWNER_REQUIRED');
  const service=new SpaceProjectCatalog(db);
  let result;
  if(command?.action==='project-catalog-read-pending'&&exact(command,['action']))result=await service.pending();
  else if(command?.action==='project-catalog-read-reply'&&exact(command,['action','requestId','result']))result=await service.settle(command.requestId,command.result);
  else throw error(400,'SPACE_PROJECT_CATALOG_INVALID');
  return reply(200,{jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false}});
 }catch(e){
  const status=[400,401,403,404,409].includes(e?.status)?e.status:503;
  if(status===401||status===403)return reply(status,{error:e.message});
  const result={error:status===503?'SPACE_PROJECT_CATALOG_UNAVAILABLE':e.message,status};
  return reply(200,{jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:true}});
 }
}
