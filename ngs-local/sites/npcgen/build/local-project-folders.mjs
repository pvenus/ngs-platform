import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync,
 readdirSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';

const fileLimit={'project.json':64*1024,'icon.png':2*1024*1024};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from([137,80,78,71,13,10,26,10]);
const uid=()=>process.getuid();
const unavailable=()=>Error('PROJECT_FOLDERS_UNAVAILABLE');
export const validProjectId=id=>typeof id==='string'&&id===id.trim()&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);

function exists(path){
 try{return lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function directory(path){
 const st=exists(path);
 if(!st)return null;
 if(!st.isDirectory()||st.uid!==uid()||(st.mode&0o077)||realpathSync(path)!==path)throw unavailable();
 return path;
}
function read(path){
 let fd;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
 try{
  const st=fstatSync(fd);
  if(!st.isFile()||st.uid!==uid()||(st.mode&0o077))throw unavailable();
  return readFileSync(fd);
 }finally{closeSync(fd);}
}
export function validateProjectFolderFile(name,bytes){
 if(bytes.length>fileLimit[name])throw unavailable();
 if(name==='icon.png'){
  if(!bytes.subarray(0,8).equals(png))throw unavailable();
  return;
 }
 let body;
 try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw unavailable();}
 if(!body||typeof body!=='object'||Array.isArray(body))throw unavailable();
 return body;
}


export function createLocalProjectFolders({root=join(homedir(),'Workspaces','NGS','data','project-catalog')}={}){
 root=resolve(root);
 const folder=id=>{
  if(!validProjectId(id))throw unavailable();
  return directory(root)?directory(join(root,id)):null;
 };
 function summary(projectId,dir){
  const bytes=dir&&read(join(dir,'project.json'));
  if(!bytes)return null;
  const data=validateProjectFolderFile('project.json',bytes);
  const name=[data.name,data.displayName,data.title].find(v=>typeof v==='string'&&v.trim())?.trim()??projectId;
  const icon=read(join(dir,'icon.png'));
  if(icon)validateProjectFolderFile('icon.png',icon);
  const iconUrl=icon?'/api/project-folders/icon?'+new URLSearchParams({projectId,sha256:sha256(icon)}):null;
  return {projectId,name,iconUrl,needsRefresh:false};
 }
 function list(allowed){
  if(!directory(root))return [];
  return readdirSync(root).filter(id=>validProjectId(id)&&allowed(id)).sort()
   .map(id=>summary(id,folder(id))).filter(Boolean);
 }
 function icon(projectId,hash){
  const dir=folder(projectId),bytes=dir&&read(join(dir,'icon.png'));
  if(!bytes||sha256(bytes)!==hash)return null;
  validateProjectFolderFile('icon.png',bytes);
  return bytes;
 }
 return {list,icon};
}
