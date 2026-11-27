// Data-driven runtime: one logical entity per placed/acquired prop; no DOM, assets or coordinates.
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const name=s=>typeof s==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(s);
const places=['scene','inventory','socket'];
const fail=()=>{throw Error('INVALID_PUZZLE_CONFIGURATION');};

export function createPuzzleRuntime({bindings,entities,rules}){
 const config=structuredClone({bindings,entities,rules});
 const specs=new Map(),ports=new Map(),byEvent=new Map();
 let state=new Map();
 for(const entity of config.entities){
  const {id,states,initial,location}=entity;
  if(!name(id)||specs.has(id)||!Array.isArray(states)||!states.length||!states.every(name)||!states.includes(initial)||!places.includes(location))fail();
  specs.set(id,new Set(states));state.set(id,{state:initial,location});
 }
 for(const [port,id] of Object.entries(config.bindings)){
  if(!name(port)||!specs.has(id))fail();
  ports.set(port,id);
 }
 const readRef=(ref,event)=>ref==='$item'?event?.item:ref==='$target'?event?.target:ports.get(ref);
 const validRef=ref=>ports.has(ref)||ref==='$item'||ref==='$target';
 const selectors=['target','item'];
 for(const rule of config.rules){
  if(!name(rule.event)||!Array.isArray(rule.require)||!Array.isArray(rule.effects)||!rule.effects.length||
   selectors.some(s=>own(rule,s)&&!ports.has(rule[s])))fail();
  for(const part of [...rule.require,...rule.effects]){
   if(!validRef(part.ref)||!['state','location'].includes(part.field)||!name(part.value)||
     (part.field==='location'&&!places.includes(part.value))||
     (part.field==='state'&&ports.has(part.ref)&&!specs.get(ports.get(part.ref)).has(part.value)))fail();
  }
  if(!byEvent.has(rule.event))byEvent.set(rule.event,[]);
  byEvent.get(rule.event).push(rule);
 }
 function dispatch(event){
  const candidates=(byEvent.get(event?.type)??[]).filter(rule=>selectors.every(s=>!own(rule,s)||ports.get(rule[s])===event[s]));
  if(!candidates.length)return {ok:false,reason:'not-linked'};
  const unmet=rule=>rule.require.find(c=>state.get(readRef(c.ref,event))?.[c.field]!==c.value);
  const eligible=candidates.filter(rule=>!unmet(rule));
  if(!eligible.length)return {ok:false,reason:'conditions',message:unmet(candidates[0])?.message??candidates[0].blocked};
  if(eligible.length!==1)return {ok:false,reason:'ambiguous'};
  const [rule]=eligible, writes=new Map();
  for(const eff of rule.effects){
   const id=readRef(eff.ref,event);
   if(!specs.has(id)||(eff.field==='state'&&!specs.get(id).has(eff.value)))return {ok:false,reason:'invalid-effect'};
   const key=id+':'+eff.field;
   if(writes.has(key)&&writes.get(key).value!==eff.value)return {ok:false,reason:'conflicting-effects'};
   writes.set(key,{id,field:eff.field,value:eff.value});
  }
  const next=new Map(state);
  for(const {id,field,value} of writes.values())next.set(id,{...next.get(id),[field]:value});
  const changes=[...new Set([...writes.values()].map(x=>x.id))].flatMap(id=>{
   const before=state.get(id),after=next.get(id);
   return before.state===after.state&&before.location===after.location?[]:[{id,before:{...before},after:{...after}}];
  });
  state=next;
  return {ok:true,message:rule.message,changes};
 }
 return Object.freeze({dispatch,get:id=>{const row=state.get(id);return row?{...row}:null;}});
}

// UI supplies elapsed time and presses; decay and lift progress are shared mechanics.
export function advancePressMeter(value,{seconds=0,presses=0}={},settings){
 if(![value,seconds,presses,settings.target,settings.gain,settings.decay].every(Number.isFinite)||
    settings.target<=0||settings.gain<=0||settings.decay<0||seconds<0||presses<0)throw Error('INVALID_PUZZLE_METER');
 return Math.min(settings.target,Math.max(0,value-seconds*settings.decay)+presses*settings.gain);
}
