// Transient display only. No story state or inventory writes before commit.
export function startTravel({durationMs,fadeMs,reduced,onPhase,onCommit,schedule=setTimeout,cancel=clearTimeout}){
 let live=true,committed=false,timer;
 const later=(fn,ms)=>{timer=schedule(()=>{if(live)fn();},ms);};
 const commit=()=>{if(!live||committed)return;committed=true;onCommit();};
 if(reduced){onPhase('arrived');commit();}
 else{onPhase('walking');later(()=>{onPhase('arrived');later(()=>{onPhase('fading');later(commit,fadeMs);},80);},durationMs);}
 return()=>{live=false;cancel(timer);};
}
