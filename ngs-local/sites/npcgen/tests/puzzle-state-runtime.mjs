import test from 'node:test';
import assert from 'node:assert/strict';
import {createPuzzleRuntime,advancePressMeter} from '../build/puzzle-state-runtime.mjs';
import {makeWellPuzzle} from '../build/well-puzzle-demo.mjs';

test('Water offering changes only the linked item after the lid opens; only returning a filled bowl completes',()=>{
 const play=makeWellPuzzle(), bowl='water-bowl';
 const pickup=()=>play.dispatch({type:'pickup',target:bowl}),drop=target=>play.dispatch({type:'drop',item:bowl,target});
 assert.equal(drop('back-well').ok,false);
 assert.equal(pickup().ok,true);
 assert.equal(pickup().ok,false);
 assert.match(drop('back-well').message,/뚜껑/);
 assert.equal(drop('altar-socket').ok,false);
 assert.equal(play.dispatch({type:'drop',target:'back-well',item:'foreign'}).reason,'not-linked');
 assert.deepEqual(play.get(bowl),{state:'empty',location:'inventory'});
 assert.equal(play.dispatch({type:'interact',target:'well-lid'}).ok,false);
 assert.equal(play.get('well-lid').state,'closed');
 assert.equal(play.dispatch({type:'meter-success',target:'well-lid'}).ok,true);
 assert.equal(drop('back-well').ok,true);
 assert.equal(drop('back-well').ok,false);
 assert.deepEqual(play.get(bowl),{state:'filled',location:'inventory'});
 assert.equal(play.get('offering-goal').state,'pending');
 assert.equal(drop('altar-socket').ok,true);
 assert.equal(drop('altar-socket').ok,false);
 assert.deepEqual(play.get(bowl),{state:'filled',location:'socket'});
 assert.equal(play.get('offering-goal').state,'done');
 assert.equal(makeWellPuzzle().get('well-lid').state,'closed');
});

test('Independent state instances, rebound ports, and invalid effects do not leak partial updates',()=>{
 const f=(ref,field,value)=>({ref,field,value});
 const config={
  bindings:{source:'red-rope',destination:'wooden-hook'},
  entities:[{id:'red-rope',states:['loose','tied'],initial:'loose',location:'inventory'},
   {id:'wooden-hook',states:['ready'],initial:'ready',location:'scene'}],
  rules:[{event:'drop',target:'destination',item:'source',require:[f('$item','state','loose')],
   effects:[f('$item','location','socket'),f('$target','state','tied')]}],
 };
 const play=createPuzzleRuntime(config);
 assert.equal(play.dispatch({type:'drop',item:'red-rope',target:'wooden-hook'}).reason,'invalid-effect');
 assert.deepEqual(play.get('red-rope'),{state:'loose',location:'inventory'});
 const valid={...config.rules[0],effects:[f('$item','state','tied')]};
 const tied=createPuzzleRuntime({...config,rules:[valid]});
 assert.equal(tied.dispatch({type:'drop',item:'red-rope',target:'wooden-hook'}).ok,true);
 assert.equal(tied.get('red-rope').state,'tied');
 assert.equal(play.get('red-rope').state,'loose');
 const ambiguous=createPuzzleRuntime({...config,rules:[valid,valid]});
 assert.equal(ambiguous.dispatch({type:'drop',item:'red-rope',target:'wooden-hook'}).reason,'ambiguous');
 assert.equal(ambiguous.get('red-rope').state,'loose');
});

test('The pure press meter decays, clamps, and does not need a platform clock',()=>{
 const profile={target:100,gain:18,decay:16};
 assert.equal(advancePressMeter(0,{presses:1},profile),18);
 assert.equal(advancePressMeter(18,{seconds:.5},profile),10);
 assert.equal(advancePressMeter(10,{seconds:1},profile),0);
 assert.equal(advancePressMeter(93,{presses:1},profile),100);
});
