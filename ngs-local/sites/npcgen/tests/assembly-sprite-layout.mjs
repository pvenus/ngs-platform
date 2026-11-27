import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblySpriteBox,scaleOf} from '../build/assembly-sprite-layout.mjs';

test('Map sprite ratios use actual asset PNG pixels and are independent of board zoom',()=>{
 const input={role:'bowl',layout:{altar:{x:40,y:60,regionId:'zone-a'}},attachments:{bowl:{x:5,y:-2}},
  asset:{width:307,height:205},region:{id:'zone-a',width:1536,height:1024}};
 const original=assemblySpriteBox(input);
 assert.deepEqual(original,{x:45,y:58,width:30700/1536,height:20500/1024});
 const double=assemblySpriteBox({...input,scale:{bowl:200}});
 assert.equal(double.x,original.x);assert.equal(double.y,original.y);
 assert.equal(double.width,2*original.width);assert.equal(double.height,2*original.height);
 assert.equal(assemblySpriteBox({...input,region:{...input.region,id:'zone-b'}}),null);
 assert.equal(scaleOf(undefined,'bowl'),100);
});
