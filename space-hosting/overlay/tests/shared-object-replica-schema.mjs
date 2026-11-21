/** Run in a staged Site package, not against an installed Site. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the packaged Sites migration is byte-for-byte the one Local uses',()=>{
 const name='0014_space_file_replica_versions.sql';
 const site=readFileSync(new URL('../drizzle/'+name,import.meta.url));
 const authority=readFileSync(new URL('../ngs-local/dev/'+name,import.meta.url));
 const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
 assert.deepEqual(site,authority);
 assert.equal(journal.entries.filter(x=>x.tag===name.slice(0,-4)).length,1);
});
