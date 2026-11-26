import assert from 'node:assert/strict';
import test from 'node:test';
import {submitCatalogSelections} from '../build/catalog-roster-edit.mjs';

test('each confirmed item is separate and partial failures never drop remaining choices',async()=>{
 const calls=[];
 const rows=['foo','bar','baz'].map(id=>({id,title:id}));
 const result=await submitCatalogSelections(rows,async row=>{
  calls.push(row.id);if(row.id==='bar')throw Error('request rejected');
 });
 assert.deepEqual(calls,['foo','bar','baz']);
 assert.deepEqual(result,{accepted:['foo','baz'],failed:['bar']});
});
