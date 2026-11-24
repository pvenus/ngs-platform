import test from 'node:test';
import assert from 'node:assert/strict';
import {validPropPayload,propPayload,propTypes} from '../build/prop-workspace-contract.mjs';

test('only the explicit candle render profile is accepted and unrelated prop animation remains byte-identical',()=>{
 const p=propPayload('animation',{propId:'candle-brass-petal-unlit-clean',source:{revision:4,sha256:'e'.repeat(64)},motionId:'ignition-chroma',prompt:'A tiny flame at the wick.'});
 assert.equal(validPropPayload(propTypes.animation,p),true);
 assert.equal(validPropPayload(propTypes.animation,{...p,renderProfile:'candle-chroma-headroom-v1'}),true);
 assert.equal(validPropPayload(propTypes.animation,{...p,renderProfile:null}),false);
 assert.equal(validPropPayload(propTypes.animation,{...p,renderProfile:'other'}),false);
 assert.equal(validPropPayload(propTypes.animation,{...p,propId:'not-the-candle',renderProfile:'candle-chroma-headroom-v1'}),false);
 assert.equal(validPropPayload(propTypes.animation,{...p,propId:'not-the-candle'}),true);
 assert.equal(validPropPayload(propTypes.animation,{...p,headroom:0.5}),false);
});
