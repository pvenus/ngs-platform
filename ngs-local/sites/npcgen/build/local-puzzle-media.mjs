/** One authorized Local puzzle. Private source bytes never enter the repo. */
import {closeSync,constants,createReadStream,fstatSync,lstatSync,openSync,readSync,realpathSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {audioResponseRange} from './local-audio-results.mjs';

export const puzzleName='binari.empty-veranda';
export const puzzlePrefix='/local-puzzle/binari-empty-veranda/';
const known=[
 ...['home','shoulders','yard','shoes','room','ribbon','doll','candle'].map(s=>s+'.webp'),
 ...['ignition','doll-dissolve','ribbon-dissolve','bowed','ending'].map(s=>s+'.mp4'),
 'intro-loop.wav',
];
const kinds={
 webp:{mime:'image/webp',maximum:4*1024*1024,magic:b=>b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'},
 mp4:{mime:'video/mp4',maximum:32*1024*1024,magic:b=>b.toString('ascii',4,8)==='ftyp'},
 wav:{mime:'audio/wav',maximum:8*1024*1024,magic:b=>b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE'},
};
const fault=(code,status)=>Object.assign(Error(code),{status});
const unavailable=()=>fault('LOCAL_PUZZLE_MEDIA_UNAVAILABLE',404);
const statePath=(path)=>lstatSync(path,{bigint:true});
const stateFd=(fd)=>fstatSync(fd,{bigint:true});
const equal=(a,b)=>a.ino===b.ino&&a.dev===b.dev&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const fileIs=(st,kind)=>st.isFile()&&st.uid===BigInt(process.getuid())&&st.nlink===1n&&
 (st.mode&0o777n)===0o600n&&st.size>=12n&&st.size<=BigInt(kind.maximum);
const openFlags=constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK;

export function openPuzzleBundle(root){
 if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root)return null;
 try{
  const home=statePath(root),uid=BigInt(process.getuid());
  if(!home.isDirectory()||home.uid!==uid||(home.mode&0o777n)!==0o700n||realpathSync(root)!==root)return null;
  const parentOk=()=>{const s=statePath(root);return s.isDirectory()&&s.ino===home.ino&&s.dev===home.dev&&s.uid===uid&&(s.mode&0o777n)===0o700n&&realpathSync(root)===root;};
  const opened=new Map();
  for(const name of known){
   const path=join(root,name),kind=kinds[name.split('.').at(-1)];
   const expected=statePath(path);
   if(!fileIs(expected,kind)||expected.dev!==home.dev)return null;
   const fd=openSync(path,openFlags);
   try{
    const bytes=Buffer.alloc(12);
    if(!equal(expected,stateFd(fd))||readSync(fd,bytes,0,12,0)!==12||!kind.magic(bytes)||!equal(expected,stateFd(fd)))return null;
   }finally{closeSync(fd);}
   opened.set(name,{path,kind,expected});
  }
  if(!parentOk())return null;
  return Object.freeze({
   async respond(name,req,res){
    const entry=opened.get(name);
    if(!entry)throw unavailable();
    let fd;
    try{
     if(!parentOk())throw unavailable();
     fd=openSync(entry.path,openFlags);
     const st=stateFd(fd);
     if(!fileIs(st,entry.kind)||!equal(entry.expected,st)||!parentOk())throw unavailable();
    }catch{
     if(fd!==undefined)closeSync(fd);
     throw unavailable();
    }
    const size=Number(entry.expected.size),range=audioResponseRange(req.headers.range,size);
    res.setHeader('Accept-Ranges','bytes');
    res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
    if(!range){
     closeSync(fd);res.statusCode=416;res.setHeader('Content-Range','bytes */'+size);return res.end();
    }
    const {start,end}=range;
    if(req.headers.range!==undefined){
     res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
    }
    res.setHeader('Content-Type',entry.kind.mime);
    res.setHeader('Content-Length',String(end-start+1));
    if(req.method==='HEAD'){closeSync(fd);return res.end();}
    // A bounded range over the very descriptor just verified; never reopening the path.
    await pipeline(createReadStream(entry.path,{fd,start,end,autoClose:true}),res);
   },
  });
 }catch{
  // The optional workspace fails closed without affecting other Local workspaces.
  return null;
 }
}
