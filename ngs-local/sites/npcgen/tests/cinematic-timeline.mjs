import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCinematicTimeline,defaultCinematicPlayback,validCinematicPlayback,cinematicStageRect} from '../build/cinematic-timeline.mjs';

test('24fps master keeps each of 45 source PNGs for exactly three ticks by default',()=>{
 const p=defaultCinematicPlayback();
 assert.equal(p.durationFrames,135);
 const sample=compileCinematicTimeline(p,45);
 for(let i=0;i<135;i++)assert.equal(sample(i).source,Math.floor(i/3));
});

test('frame-speed curve is integrated deterministically; zero speed holds, later phase clamps',()=>{
 const p={durationFrames:100,speedCurve:[{frame:0,rate:0},{frame:12,rate:0},{frame:24,rate:2},{frame:36,rate:0}],
  cameraCurve:[{frame:0,zoom:1,x:.5,y:.5},{frame:40,zoom:2,x:.7,y:.55},{frame:80,zoom:1,x:.5,y:.5}]};
 const sample=compileCinematicTimeline(p,45);
 assert.equal(sample(10).source,0);assert.equal(sample(18).source,3);
 assert.equal(sample(24).source,12);assert.equal(sample(36).source,24);
 assert.equal(sample(90).source,24);assert.equal(sample(10).source,0);
 assert.equal(sample(20).zoom,1.5);assert.equal(sample(60).zoom,1.5);
 assert.equal(sample(9).zoom,1.12909375);
 p.speedCurve[0].rate=4;assert.equal(sample(10).source,0);
});

test('camera framing covers clipped stage at both extreme center points, no blank borders',()=>{
 for(const x of [0,.5,1])for(const y of [0,.5,1])for(const zoom of [1,1.23,3]){
  const r=cinematicStageRect(1920,1080,512,352,{zoom,x,y});
  assert(r.left<=0&&r.top<=0&&r.left+r.width>=1920&&r.top+r.height>=1080);
  assert.equal(r.width/r.height,512/352);
 }
});

test('timeline rejects duplicate, non-finite and out-of-range author data',()=>{
 const p=defaultCinematicPlayback();
 for(const invalid of [
  {...p,durationFrames:1441}, {...p,durationFrames:0},
  {...p,speedCurve:[{frame:0,rate:0},{frame:0,rate:1}]},
  {...p,speedCurve:[{frame:0,rate:Infinity}]},
  {...p,cameraCurve:[{frame:0,zoom:.9,x:.5,y:.5}]},
  {...p,cameraCurve:[{frame:0,zoom:1,x:'.5',y:.5}]},
 ])assert.equal(validCinematicPlayback(invalid),false);
});
