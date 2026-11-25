import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCinematicTimeline,cinematicSpeedAt,defaultCinematicPlayback,validCinematicPlayback,cinematicStageRect} from '../build/cinematic-timeline.mjs';

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
 assert.equal(sample(10).source,0);assert.equal(sample(18).source,2);
 assert.equal(sample(24).source,12);assert.equal(sample(36).source,24);
 assert.equal(sample(90).source,24);assert.equal(sample(10).source,0);
 assert.equal(sample(20).zoom,1.5);assert.equal(sample(60).zoom,1.5);
 assert.equal(sample(9).zoom,1.12909375);
 p.speedCurve[0].rate=4;assert.equal(sample(10).source,0);
});

test('speed eases up and down, preserves exact keys and keeps equal-rate sections flat',()=>{
 const keys=[{frame:0,rate:0},{frame:24,rate:4},{frame:48,rate:4},{frame:72,rate:0}];
 const rate=t=>cinematicSpeedAt(keys,t);
 for(const k of keys)assert.equal(rate(k.frame),k.rate);
 for(const t of [6,18,36,54,66,95])assert.equal(rate(t),{
  6:.625,18:3.375,36:4,54:3.375,66:.625,95:0
 }[t]);
 assert(rate(23.99)>3.99999);
 assert(rate(48.01)>3.99999);
});

test('ease integration is deterministic on seek and preserves distance at speed keys',()=>{
 const p={...defaultCinematicPlayback(),durationFrames:60,
  speedCurve:[{frame:0,rate:0},{frame:24,rate:2},{frame:48,rate:0}]};
 const sample=compileCinematicTimeline(p,96);
 assert.deepEqual([0,6,12,18,24,30,36,42,48,59].map(i=>sample(i).source),[0,0,4,12,24,35,43,47,48,48]);
 assert.equal(sample(18).source,12);
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
