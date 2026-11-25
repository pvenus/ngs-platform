/** Pure cinematic timing and camera math. No DOM, timers, files or Unity objects. */
export const MASTER_FPS=24;
export const MAX_DURATION_FRAMES=1440;
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const between=(x,a,b)=>typeof x==='number'&&Number.isFinite(x)&&a<=x&&x<=b;
const bound=(n,a,b)=>Math.min(b,Math.max(a,n));
const smoothStep=u=>u*u*(3-2*u);
function validKeys(rows,duration,keys,extra){
 if(!Array.isArray(rows)||rows.length<1||rows.length>128||rows[0]?.frame!==0)return false;
 return rows.every((row,i)=>exact(row,keys)&&Number.isInteger(row.frame)&&row.frame<duration&&
  (i===0?row.frame===0:row.frame>rows[i-1].frame)&&extra(row));
}
export function validCinematicPlayback(t){
 if(!exact(t,['durationFrames','speedCurve','cameraCurve'])||!Number.isInteger(t.durationFrames)||
  !between(t.durationFrames,1,MAX_DURATION_FRAMES))return false;
 return validKeys(t.speedCurve,t.durationFrames,['frame','rate'],p=>between(p.rate,0,4))&&
  validKeys(t.cameraCurve,t.durationFrames,['frame','zoom','x','y'],p=>between(p.zoom,1,3)&&between(p.x,0,1)&&between(p.y,0,1));
}
export function defaultCinematicPlayback(frameCount=45){
 if(!Number.isInteger(frameCount)||frameCount<1||frameCount>96)throw Error('CINEMATIC_FRAME_COUNT_INVALID');
 return {durationFrames:frameCount*3,speedCurve:[{frame:0,rate:1/3}],cameraCurve:[{frame:0,zoom:1,x:.5,y:.5}]};
}
function cameraAt(keys,t){
 const n=keys.findIndex(k=>k.frame>t);
 if(n<1)return keys.at(-1);
 const a=keys[n-1],b=keys[n];
 const u=(t-a.frame)/(b.frame-a.frame),ease=smoothStep(u);
 return {zoom:a.zoom+(b.zoom-a.zoom)*ease,x:a.x+(b.x-a.x)*ease,y:a.y+(b.y-a.y)*ease};
}
export function cinematicSpeedAt(rates,t){
 const j=rates.findIndex(k=>k.frame>t);
 if(j===0)return rates[0].rate;
 if(j<0)return rates.at(-1).rate;
 const a=rates[j-1],b=rates[j],u=(t-a.frame)/(b.frame-a.frame);
 return a.rate+(b.rate-a.rate)*smoothStep(u);
}
function integral(rates,t){
 let value=0;
 for(let i=0;i<rates.length;i++){
  const a=rates[i],b=rates[i+1];
  if(a.frame>=t)break;
  const dt=(b?Math.min(b.frame,t):t)-a.frame;
  // Integrate the same cubic S-curve exactly so seeking and playback agree.
  const u=b?dt/(b.frame-a.frame):0;
  const weight=u*u*(1-u/2);
  value+=dt*(a.rate+(b?(b.rate-a.rate)*weight:0));
 }
 return value;
}
/** Compile once, sample whenever. The animation clock never accumulates frame drift. */
export function compileCinematicTimeline(playback,sourceCount){
 if(!validCinematicPlayback(playback)||!Number.isInteger(sourceCount)||sourceCount<1||sourceCount>96)
  throw Error('CINEMATIC_TIMELINE_INVALID');
 const clock=structuredClone(playback);
 return (masterFrame)=>{
  if(!Number.isFinite(masterFrame))throw Error('CINEMATIC_TIME_INVALID');
  const t=bound(masterFrame,0,clock.durationFrames-1);
  const source=bound(Math.floor(integral(clock.speedCurve,t)+1e-9),0,sourceCount-1);
  const {zoom,x,y}=cameraAt(clock.cameraCurve,t);
  return {source,zoom,x,y};
 };
}
/** Virtual camera: image covering a clipped stage. Units are viewport pixels. */
export function cinematicStageRect(viewWidth,viewHeight,imageWidth,imageHeight,camera){
 if(![viewWidth,viewHeight,imageWidth,imageHeight].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)||
    !between(camera?.zoom,1,3)||!between(camera?.x,0,1)||!between(camera?.y,0,1))
  throw Error('CINEMATIC_CAMERA_INVALID');
 const z=Math.max(viewWidth/imageWidth,viewHeight/imageHeight)*camera.zoom;
 const width=imageWidth*z,height=imageHeight*z;
 return {width,height,left:bound(viewWidth/2-camera.x*width,viewWidth-width,0),
  top:bound(viewHeight/2-camera.y*height,viewHeight-height,0)};
}
