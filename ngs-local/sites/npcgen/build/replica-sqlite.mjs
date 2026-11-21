/** Dedicated Node/SQLite port for the portable object replica (never RS or request queues). */
import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync,readSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const source=realpathSync(fileURLToPath(new URL('../../../',import.meta.url)));
const migrationPath=new URL('../../../dev/0014_space_file_replica_versions.sql',import.meta.url);
const applicationId=0x4e475352; // NGSR; SQLite file header never identifies an RS store
const schemaVersion=14;
const maximumSchema=32*1024;
const knownTables=['ngs_replica_pass_v2','ngs_replica_receive_v2','ngs_replica_reset_v2','ngs_replica_schema_pin_v1','ngs_replica_version_v2'];
const sqliteMagic=Buffer.from('SQLite format 3\0');
const error=(code='NGS_REPLICA_SQLITE_UNAVAILABLE')=>Object.assign(Error(code),{status:503});
const invalid=()=>error('NGS_REPLICA_SQLITE_INVALID');
const denied=()=>error('NGS_REPLICA_SQLITE_FILE_DENIED');
const schemaWrong=()=>error('NGS_REPLICA_SQLITE_SCHEMA_MISMATCH');
const uid=process.getuid();
const ownsPrivate=s=>s.uid===uid&&!(s.mode&0o077);
const regular=s=>s?.isFile()&&ownsPrivate(s)&&s.nlink===1;
const readOptions=constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;

export function replicaSqliteSchema(){
 try{return readFileSync(migrationPath,'utf8');}catch{throw schemaWrong();}
}
function migration(value){
 if(typeof value!=='string'||!value.length||Buffer.byteLength(value)>maximumSchema||value.includes('\0'))throw schemaWrong();
 const commands=value.split(';').map(x=>x.replace(/^\s*--> statement-breakpoint\s*/u,'').trim()).filter(Boolean);
 // The existing shared migration only declares replica tables and indexes.
 // A bootstrap input cannot attach, select or mutate any unrelated schema.
 if(commands.length!==7||!commands.every(sql=>/^CREATE (?:TABLE ngs_replica_(?:pass|receive|version|reset)_v2\s*\(|(?:UNIQUE )?INDEX ngs_replica_version_v2_(?:path|sync|object)\s+ON ngs_replica_version_v2\s*\()/u.test(sql)))throw schemaWrong();
 return {commands,sha256:createHash('sha256').update(value).digest('hex')};
}
function checkFile(filename,readOnly){
 if(typeof filename!=='string'||!isAbsolute(filename)||resolve(filename)!==filename||
    filename===source||filename.startsWith(source+sep))throw denied();
 const directory=dirname(filename);
 let parent;
 try{parent=lstatSync(directory);}catch{throw denied();}
 if(!parent.isDirectory()||!ownsPrivate(parent)||realpathSync(directory)!==directory||directory===source||directory.startsWith(source+sep))throw denied();
 let fresh=false;
 if(!readOnly)try{
  closeSync(openSync(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600));
  fresh=true;
 }catch(e){if(e?.code!=='EEXIST')throw denied();}
 let initial;
 try{initial=lstatSync(filename);}catch{throw denied();}
 if(!regular(initial)||realpathSync(filename)!==filename)throw denied();
 for(const suffix of ['-wal','-shm','-journal']){
  try{
   const child=filename+suffix,st=lstatSync(child);
   if(!regular(st)||realpathSync(child)!==child)throw denied();
  }catch(e){if(e?.code!=='ENOENT')throw e;}
 }
 if(!fresh){
  // Refuse to even open a plausible RS or user SQLite database in writable mode.
  const fd=openSync(filename,readOptions);
  try{
   const actual=fstatSync(fd),header=Buffer.alloc(100);
   if(!regular(actual)||!same(actual,initial)||readSync(fd,header,0,header.length,0)!==header.length||
      !header.subarray(0,16).equals(sqliteMagic)||header.readUInt32BE(68)!==applicationId)throw denied();
  }finally{closeSync(fd);}
 }
 return {fresh,initial};
}
const result=(results,meta={})=>({success:true,results,meta:{changes:Number(meta.changes??0),last_row_id:Number(meta.lastInsertRowid??0)}});
const rows=values=>values.map(value=>({...value}));
function permittedBindings(args){
 return args.length<=256&&args.every(x=>x===null||typeof x==='string'||
  typeof x==='number'&&Number.isFinite(x)||typeof x==='bigint'||x instanceof Uint8Array);
}

/** `migrationSql` is trusted release source; falsey inputs are not implicitly accepted. */
export function openReplicaSqlite({filename,migrationSql=replicaSqliteSchema(),readOnly=false}={}){
 const {commands,sha256}=migration(migrationSql);
 const memory=filename===':memory:';
 if(typeof readOnly!=='boolean'||memory&&readOnly)throw invalid();
 const file=memory?null:checkFile(filename,readOnly);
 const db=new DatabaseSync(filename,{timeout:5000,allowExtension:false,enableForeignKeyConstraints:true,readOnly});
 let closed=false;
 try{
  db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF');
  db.exec(readOnly?'PRAGMA query_only=ON':'PRAGMA synchronous=FULL');
  if(memory||file.fresh){
   // Keep SQLite's initial rollback journal until the file marker is durable.
   db.exec('BEGIN IMMEDIATE');
   try{
    for(const sql of commands)db.exec(sql);
    db.exec('CREATE TABLE ngs_replica_schema_pin_v1(tag TEXT PRIMARY KEY NOT NULL, digest TEXT NOT NULL)');
    db.prepare('INSERT INTO ngs_replica_schema_pin_v1(tag,digest) VALUES(?,?)').run('space-file-replica-v2',sha256);
    db.exec('PRAGMA application_id='+applicationId+'; PRAGMA user_version='+schemaVersion+'; COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
  const app=db.prepare('PRAGMA application_id').get(),version=db.prepare('PRAGMA user_version').get();
  const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
  if(app?.application_id!==applicationId||version?.user_version!==schemaVersion||JSON.stringify(tables)!==JSON.stringify(knownTables)||
     db.prepare('SELECT digest FROM ngs_replica_schema_pin_v1 WHERE tag=?').get('space-file-replica-v2')?.digest!==sha256)throw schemaWrong();
  if(!memory){
   const pathCheck=lstatSync(filename);
   if(!regular(pathCheck)||!same(file.initial,pathCheck)||realpathSync(filename)!==filename)throw denied();
   const wal=db.prepare(readOnly?'PRAGMA journal_mode':'PRAGMA journal_mode=WAL').get();
   if(wal?.journal_mode!=='wal')throw error();
  }
  db.enableDefensive(true);
 }catch(e){
  db.close();throw e;
 }
 const statements=new WeakMap();
 const ensureOpen=()=>{if(closed)throw error();};
 function bind(sql,args){
  ensureOpen();
  if(!permittedBindings(args))throw invalid();
  const operation=sql.match(/^[A-Z]+/i)?.[0].toUpperCase(),stmt=db.prepare(sql);
  const reads=operation==='SELECT';
  if(reads!==Boolean(stmt.columns().length))throw invalid(); // The core does not use RETURNING.
  const rowResults=()=>rows(stmt.all(...args));
  const change=()=>stmt.run(...args);
  const capability=Object.freeze({
   bind(...inputs){return bind(sql,inputs);},
   async first(column){
    ensureOpen();if(!reads)throw invalid();
    const row=stmt.get(...args);if(!row)return null;
    if(column===undefined)return {...row};
    if(typeof column!=='string'||!Object.hasOwn(row,column))throw invalid();
    return row[column];
   },
   async all(){ensureOpen();if(!reads)throw invalid();return result(rowResults());},
   async run(){ensureOpen();if(reads||readOnly)throw invalid();return result([],change());},
  });
  statements.set(capability,()=>reads?result(rowResults()):result([],change()));
  return capability;
 }
 return Object.freeze({
  prepare(sql){
   ensureOpen();
   if(typeof sql!=='string'||sql.length>32768||!/^\s*(?:SELECT|INSERT|UPDATE|DELETE)\b/iu.test(sql)||/[;\x00]/u.test(sql))throw invalid();
   return bind(sql.trim(),[]);
  },
  async batch(commands){
   ensureOpen();
   if(readOnly||!Array.isArray(commands)||commands.length<1||commands.length>64||commands.some(s=>!statements.has(s)))throw invalid();
   // All sync statements run inside one SQLite transaction, without an async
   // interleave. A D1 reset fence observes, updates and clears atomically.
   db.exec('BEGIN IMMEDIATE');
   try{
    const results=commands.map(s=>statements.get(s)());
    db.exec('COMMIT');return results;
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  close(){if(!closed){db.close();closed=true;}},
 });
}
