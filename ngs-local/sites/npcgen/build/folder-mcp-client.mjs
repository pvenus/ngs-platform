/** Transport-neutral folder tool contract for local NGS and approved hosted transport. */
const maxManifest=16*1024*1024,maxEntries=32768,maxChunk=1024*1024;
const responseBytes=64*1024*1024; // metadata JSON can include both structured and textual MCP results
const rpcError=()=>Error('FOLDER_MCP_UNAVAILABLE');

function decodedBase64(encoded){
 if(typeof encoded!=='string'||encoded.length>Math.ceil(maxChunk/3)*4)throw rpcError();
 let binary;
 try{binary=atob(encoded);}catch{throw rpcError();}
 if(binary.length>maxChunk||btoa(binary)!==encoded)throw rpcError();
 const raw=new Uint8Array(binary.length);
 for(let i=0;i<raw.length;i++)raw[i]=binary.charCodeAt(i);
 return raw;
}

export function createFolderMcpClient({call}){
 const discover=()=>call('npc_project_folders_list',{});
 async function compare(scope,files,{includeDeleted=false}={}){
  if(typeof includeDeleted!=='boolean')throw rpcError();
  const params={scope,files,...(includeDeleted?{includeDeleted:true}:{})};
  if(files.length>maxEntries||new TextEncoder().encode(JSON.stringify(params)).byteLength>maxManifest)throw rpcError();
  return call('npc_folders_compare',params,{limit:responseBytes});
 }
 function file(scope,path,sha256,size){
  let offset=0;
  const body=new ReadableStream({
   async pull(controller){
    try{
     const row=await call('npc_folder_file_chunk',{scope,path,sha256,offset});
     if(!row||Object.keys(row).sort().join(',')!=='base64,nextOffset,offset,path,scope,sha256,size'
      ||row.scope!==scope||row.path!==path||row.sha256!==sha256||row.size!==size||row.offset!==offset)throw rpcError();
     const bytes=decodedBase64(row.base64),end=offset+bytes.byteLength;
     if(row.nextOffset!==(end===size?null:end)||end>size||end<size&&bytes.length===0)throw rpcError();
     if(bytes.length)controller.enqueue(bytes);
     if(row.nextOffset===null)controller.close();
     else offset=row.nextOffset;
    }catch(error){controller.error(error);}
   },
  },{highWaterMark:0});
  return {headers:{get:name=>name==='content-length'?String(size):null},body};
 }
 return {discover,compare,file};
}
