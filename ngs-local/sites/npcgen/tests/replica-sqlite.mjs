import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openReplicaSqlite,replicaSqliteSchema} from '../build/replica-sqlite.mjs';

const insert='INSERT INTO ngs_replica_pass_v2(sync_id,baseline,expiry) VALUES(?,?,?)';
const find='SELECT sync_id,baseline,expiry FROM ngs_replica_pass_v2 WHERE sync_id=?';
const count='SELECT COUNT(*) AS total FROM ngs_replica_pass_v2';
function fixture(t){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-replica-sqlite-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));return root;
}
test('D1-shaped sqlite port uses canonical schema, parameter binds and normal D1 row results',async t=>{
 const db=openReplicaSqlite({filename:':memory:'});t.after(()=>db.close());
 const key="fixture'); DROP TABLE ngs_replica_pass_v2; --";
 const statement=db.prepare(insert).bind(key,11,1234);
 const mutation=await statement.run();assert.equal(mutation.success,true);assert.equal(mutation.meta.changes,1);
 const read=db.prepare(find).bind(key);
 assert.deepEqual(await read.first(),{sync_id:key,baseline:11,expiry:1234});
 assert.equal(await read.first('expiry'),1234);
 assert.deepEqual((await read.all()).results,[{sync_id:key,baseline:11,expiry:1234}]);
 assert.equal(await db.prepare(find).bind('none').first(),null);
 assert.throws(()=>db.prepare('ATTACH DATABASE ? AS leak'),/INVALID/);
 assert.throws(()=>db.prepare(count+'; DELETE FROM ngs_replica_pass_v2'),/INVALID/);
 assert.throws(()=>db.prepare(find).bind({ignored:true}),/INVALID/);
 assert.equal(await db.prepare(count).first('total'),1);
});
test('batch reset shape is one transaction, gives SELECT rows and rolls back a failed later statement',async t=>{
 const db=openReplicaSqlite({filename:':memory:'});t.after(()=>db.close());
 await db.prepare(insert).bind('pass',1,456).run();
 const capture=db.prepare(find).bind('pass'),update=db.prepare('UPDATE ngs_replica_pass_v2 SET expiry=? WHERE sync_id=?').bind(789,'pass');
 const conflicting=db.prepare(insert).bind('pass',3,1098);
 await assert.rejects(db.batch([capture,update,conflicting]));
 assert.equal(await capture.first('expiry'),456);
 const [old,edited,current]=await db.batch([capture,update,capture]);
 assert.equal(old.results[0].expiry,456);
 assert.equal(edited.meta.changes,1);
 assert.equal(current.results[0].expiry,789);
 const other=openReplicaSqlite({filename:':memory:'});t.after(()=>other.close());
 await assert.rejects(db.batch([other.prepare(count)]),/INVALID/);
});
test('private object replica persists across close/reopen and shares WAL metadata across handles',async t=>{
 const path=join(fixture(t),'versions.sqlite'),first=openReplicaSqlite({filename:path});
 try{
  assert.equal(lstatSync(path).mode&0o777,0o600);
  await first.prepare(insert).bind('pass',1,456).run();
  const second=openReplicaSqlite({filename:path});
  try{
   assert.equal(await second.prepare(find).bind('pass').first('expiry'),456);
   await second.prepare('UPDATE ngs_replica_pass_v2 SET expiry=? WHERE sync_id=?').bind(789,'pass').run();
   assert.equal(await first.prepare(find).bind('pass').first('expiry'),789);
  }finally{second.close();}
 }finally{first.close();}
 const third=openReplicaSqlite({filename:path});
 try{assert.equal(await third.prepare(find).bind('pass').first('expiry'),789);}
 finally{third.close();}
 await assert.rejects(third.batch([{}]),/UNAVAILABLE/);
 assert.throws(()=>openReplicaSqlite({filename:path,migrationSql:replicaSqliteSchema().trimEnd()}),/SCHEMA_MISMATCH/);
});
test('the SQLite port cannot use an existing queue, symlink, or broad directory as its store',t=>{
 const root=fixture(t),foreign=join(root,'queue.sqlite'),db=new DatabaseSync(foreign);
 db.exec('CREATE TABLE local_request_queue_v1 (id TEXT PRIMARY KEY)');db.close();chmodSync(foreign,0o600);
 const before=readFileSync(foreign);
 assert.throws(()=>openReplicaSqlite({filename:foreign}),/FILE_DENIED/);
 assert.deepEqual(readFileSync(foreign),before);
 const link=join(root,'link.sqlite');symlinkSync(foreign,link);
 assert.throws(()=>openReplicaSqlite({filename:link}),/FILE_DENIED/);
 const broad=join(root,'public');mkdirSync(broad,{mode:0o755});chmodSync(broad,0o755);
 assert.throws(()=>openReplicaSqlite({filename:join(broad,'db.sqlite')}),/FILE_DENIED/);
 assert.throws(()=>openReplicaSqlite({filename:':memory:',migrationSql:'DROP TABLE bad;'}),/SCHEMA_MISMATCH/);
});

test('web mode checks an existing dedicated schema and never bootstraps or mutates it',async t=>{
 const path=join(fixture(t),'versions.sqlite');
 assert.throws(()=>openReplicaSqlite({filename:path,readOnly:true}),/FILE_DENIED/);
 assert.equal(existsSync(path),false);
 const writer=openReplicaSqlite({filename:path});t.after(()=>writer.close());
 const reader=openReplicaSqlite({filename:path,readOnly:true});t.after(()=>reader.close());
 await writer.prepare(insert).bind('pass',2,456).run();
 assert.deepEqual(await reader.prepare(find).bind('pass').first(),{sync_id:'pass',baseline:2,expiry:456});
 await assert.rejects(reader.prepare(insert).bind('bad',5,123).run(),/INVALID/);
 await assert.rejects(reader.batch([reader.prepare(count)]),/INVALID/);
 assert.equal(await writer.prepare(count).first('total'),1);
});

test('an exact v14 replica upgrades with rows preserved and can revert only new progress schema',async t=>{
 const path=join(fixture(t),'legacy.sqlite'),source=replicaSqliteSchema();
 const {createHash}=await import('node:crypto');
 const db=new DatabaseSync(path);
 db.exec(source);
 db.exec('CREATE TABLE ngs_replica_schema_pin_v1(tag TEXT PRIMARY KEY NOT NULL,digest TEXT NOT NULL)');
 db.prepare('INSERT INTO ngs_replica_schema_pin_v1(tag,digest) VALUES(?,?)').run('space-file-replica-v2',createHash('sha256').update(source).digest('hex'));
 db.exec('PRAGMA application_id=0x4e475352; PRAGMA user_version=14; PRAGMA journal_mode=WAL');
 db.prepare('INSERT INTO ngs_replica_version_v2(path,sha256,object_key,size,sync_id) VALUES(?,?,?,?,?)')
  .run('original/asset.bin','a'.repeat(64),'preserve-original-object',25,'legacy-pass');
 const original={...db.prepare('SELECT * FROM ngs_replica_version_v2').get()};
 const oldTables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r=>r.name);
 db.close();chmodSync(path,0o600);
 assert.throws(()=>openReplicaSqlite({filename:path,readOnly:true}),/SCHEMA_MISMATCH/);
 const writer=openReplicaSqlite({filename:path});
 await writer.prepare("INSERT INTO ngs_replica_progress_v1(sync_id,total) VALUES(?,?)").bind('progress-only',1).run();
 await writer.prepare("INSERT INTO ngs_replica_progress_item_v1(sync_id,path,state) VALUES(?,?,'completed')").bind('progress-only','x').run();
 assert.equal((await writer.prepare("SELECT completed FROM ngs_replica_progress_v1 WHERE sync_id=?").bind('progress-only').first()).completed,1);
 const reader=openReplicaSqlite({filename:path,readOnly:true});
 assert.deepEqual(await reader.prepare('SELECT * FROM ngs_replica_version_v2').first(),original);
 reader.close();writer.close();
 const reverted=new DatabaseSync(path);
 assert.equal(reverted.prepare('PRAGMA user_version').get().user_version,16);
 reverted.exec(`BEGIN IMMEDIATE;
 DROP TABLE ngs_audio_result_index_v1;
 DROP TABLE ngs_audio_result_index_progress_v1;
 DELETE FROM ngs_replica_schema_pin_v1 WHERE tag='audio-result-index-v1';
 DROP TRIGGER ngs_replica_progress_count_v1;
 DROP TABLE ngs_replica_progress_item_v1;
 DROP TABLE ngs_replica_progress_v1;
 DELETE FROM ngs_replica_schema_pin_v1 WHERE tag='replica-sync-progress-v1';
 PRAGMA user_version=14;
 COMMIT;`);
 assert.deepEqual(reverted.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r=>r.name),oldTables);
 assert.equal(reverted.prepare('PRAGMA application_id').get().application_id,0x4e475352);
 assert.equal(reverted.prepare('PRAGMA user_version').get().user_version,14);
 assert.deepEqual({...reverted.prepare('SELECT * FROM ngs_replica_version_v2').get()},original);
 assert.deepEqual(reverted.prepare('SELECT tag FROM ngs_replica_schema_pin_v1').all().map(r=>r.tag),['space-file-replica-v2']);
 reverted.close();
});
