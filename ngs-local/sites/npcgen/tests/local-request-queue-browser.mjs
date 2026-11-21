import test from 'node:test';
import assert from 'node:assert/strict';
import {isQueuedRequest,submitQueuedRequest} from '../build/local-request-queue-browser.mjs';
import {createAudioIntake} from '../build/local-audio-workspace.mjs';
import {createNpcOneStopIntake} from '../build/local-npc-one-stop-ui.mjs';
import {createNpcPlanningIntake} from '../build/local-npc-planning-ui.mjs';
const accepted={queueId:'ngs.local.00000000-0000-4000-8000-000000000000',status:'queued'};
const pending=()=>Response.json(accepted,{status:202});
const jsonPost=command=>({method:'POST',body:JSON.stringify(command)});
test('browser returns on local durable acknowledgment without fetching RS status',async()=>{
 const paths=[];
 const response=await submitQueuedRequest({requestType:'fixture'},{jsonPost,fetcher:async(path,options)=>{
  paths.push([path,options.method]);return pending();
 }});
 assert.equal(response.status,202);
 assert.deepEqual(paths,[['/api/requests','POST']]);
 assert.equal(isQueuedRequest(response,await response.json()),true);
 assert.equal(isQueuedRequest(pending(),{...accepted,queueId:'wrong'}),false);
});
test('audio and NPC forms accept local storage without an official request id',async()=>{
 const submit=async()=>pending(),uuid=()=>'fixture';
 const audio=createAudioIntake(submit,{uuid}),npc=createNpcOneStopIntake(submit,{key:uuid});
 const plan=createNpcPlanningIntake(submit,{uuid,build:()=>({})});
 assert.deepEqual(await audio.send(()=>({})),accepted);
 assert.deepEqual(await npc.send(()=>({})),accepted);
 assert.deepEqual(await plan.send({},{}),accepted);
 assert.equal(audio.uncertain,false);
 assert.equal(npc.waitingConfirmation,false);
 assert.equal(plan.waiting,false);
});
