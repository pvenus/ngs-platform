import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyUpdateRoot,mapUpdateRoot,validFileUpdate} from '../build/file-update-envelope.mjs';
import {decorationArt,decorationBox,decorationsLoader,missingDecorationImage} from '../build/assembly-sprite-layout.mjs';
import {mapDecorPinKey,propImageScalePercents} from '../build/map-contract.mjs';
import {buildWellRehearsal,buildSpiritRehearsal} from '../build/well-assembly-ui.mjs';

const sha='a'.repeat(64),id='request.official.'+sha,pin={propId:'placed-prop',revision:1,sha256:sha};
const media=(tag,width,height)=>({width,height,mediaType:'image/png',url:'/api/prop-workspace?'+tag});
const prop={propId:pin.propId,source:{revision:pin.revision,sha256:pin.sha256},
 media:{pixel:media('legacy-query',200,100),spirit:media('legacy-spirit',200,100)},
 scaleVariants:[{scalePercent:20,pixel:media('scale-20',100,50),spirit:media('spirit-20',100,50)},
 {scalePercent:50,pixel:media('scale-50',250,125),spirit:media('spirit-50',250,125)}]};
const region={id:'room',name:'마당',description:'마당 전체',backgroundId:'background.'+sha,imageSha256:sha};
const graph={title:'굿터',regions:[region],connections:[],startRegionId:region.id,startPoint:{x:500,y:500}};
const room={id:region.id,width:1000,height:500};
const map={schemaVersion:'ngs.map-metadata.v1',projectId:'binari',mapId:id,officialRequestId:id,revision:1,updatedAt:0,graph};
const backgrounds=[{backgroundId:region.backgroundId,pixel:{sha256:sha,width:1000,height:500}}];
const puzzle={id:'water',type:'binari.ritual-well-water-demo',layout:{altar:{regionId:region.id,x:40,y:65},well:{regionId:region.id,x:55,y:68}},
 attachments:{bowl:{x:0,y:0},lid:{x:0,y:0}},bindings:{table:pin,bowl:pin,well:pin,lid:pin}};
const decoration={id:'lantern',regionId:region.id,prop:pin,anchor:{x:500,y:500},scale:150,visibility:'both'};
const update=(root,content)=>({schemaVersion:'ngs.file-update.v1',projectId:'binari',target:{root,path:id,kind:'metadata'},expected:{revision:1,officialRequestId:id},content});

test('asset scale is optional and independent of placement transform in both formal file updates',()=>{
 const mapUpdate=v=>update(mapUpdateRoot,{...graph,decorations:[{...decoration,...v}]});
 const assemblyUpdate=v=>update(assemblyUpdateRoot,{title:'굿상',mapId:id,puzzles:[{...puzzle,bindings:{...puzzle.bindings,bowl:{...pin,...v}}}]});
 for(const body of [mapUpdate({}),assemblyUpdate({})])assert.ok(validFileUpdate(body));
 for(const scale of propImageScalePercents){
  assert.ok(validFileUpdate(mapUpdate({imageScalePercent:scale})));
  assert.ok(validFileUpdate(assemblyUpdate({imageScalePercent:scale})));
 }
 for(const scale of [null,'20',0,15,99,110]){
  assert.equal(validFileUpdate(mapUpdate({imageScalePercent:scale})),false);
  assert.equal(validFileUpdate(assemblyUpdate({imageScalePercent:scale})),false);
 }
});
test('multiple map placements of one pin render their own paired resource without fallback',async()=>{
 let reads=0;
 const loader=decorationsLoader(async()=>{reads++;return {prop};},'binari');
 const small={...decoration,imageScalePercent:20},large={...decoration,imageScalePercent:50};
 const cache=await loader.load([decoration,small,large]);
 const art=cache.get(mapDecorPinKey(pin));
 assert.equal(reads,1);
 assert.equal(decorationBox(decoration,art,room,false).src,prop.media.pixel.url);
 assert.equal(decorationBox(small,art,room,false).width,15); // 100 px x 150% / 1000 px
 assert.equal(decorationBox(small,art,room,true).src,prop.scaleVariants[0].spirit.url);
 assert.equal(decorationBox(large,art,room,false).width,37.5);
 assert.equal(decorationBox({...small,imageScalePercent:70},art,room,false),null);
 assert.ok(missingDecorationImage({...small,imageScalePercent:70},art));
 assert.ok(!missingDecorationImage(small,art));
});
test('assembly edit rehearsal and published playback choose the same pin, optionally reverting to legacy',()=>{
 const bindings=Object.fromEntries(Object.keys(puzzle.bindings).map(role=>[role,pin.propId]));
 const media=Object.fromEntries(Object.keys(bindings).map(role=>[role,prop]));
 const source={map,backgrounds,props:[pin],layout:puzzle.layout,attachments:puzzle.attachments,bindings,media,
  pins:{...puzzle.bindings,bowl:{...pin,imageScalePercent:20}},scale:{bowl:150}};
 const published=buildWellRehearsal(source),draft=buildWellRehearsal({...source,imageScales:{bowl:20}});
 assert.deepEqual(draft,published);
 assert.equal(published.art.bowl,prop.scaleVariants[0].pixel.url);
 assert.equal(published.spiritArt.bowl,prop.scaleVariants[0].spirit.url);
 assert.deepEqual(published.artSizes.bowl,{width:100,height:50});
 assert.equal(published.scale.bowl,150);
 assert.equal(buildWellRehearsal({...source,imageScales:{}}).art.bowl,prop.media.pixel.url);
 assert.throws(()=>buildWellRehearsal({...source,imageScales:{bowl:80}}),/PROP_ART_MISSING_OR_STALE/);
 const spirit=buildSpiritRehearsal(map,backgrounds,puzzle.layout.altar,100,prop,pin,new Map(),{},50);
 assert.equal(spirit.media.cinematic.url,prop.scaleVariants[1].spirit.url);
 assert.equal(spirit.media.pixel.width,250);
 assert.equal(decorationArt({...prop,source:{...prop.source,revision:2}},pin),null);
});
test('appending variants in a new prop revision does not break earlier map pins',async()=>{
 const latest={...prop,source:{revision:2,sha256:'b'.repeat(64)},scaleVariants:[...prop.scaleVariants]};
 const reads=[];
 const loader=decorationsLoader(async url=>{
  const query=new URL(url,'http://localhost').searchParams;reads.push(query);
  if(!query.has('revision'))return {prop:latest};
  assert.equal(query.get('revision'),'1');assert.equal(query.get('sha256'),sha);
  return {prop};
 },'binari');
 const newestPin={...pin,...latest.source},small={...decoration,imageScalePercent:20};
 const cache=await loader.load([small,{...small,prop:newestPin}]);
 assert.equal(reads.length,2);
 assert.equal(decorationBox(small,cache.get(mapDecorPinKey(pin)),room,false)?.src,prop.scaleVariants[0].pixel.url);
});

test('assembly inspector previews and submits the selected variant independently of placement size',{skip:!process.env.CHROME_BIN},async t=>{
 const {createServer}=await import('node:http');
 const {createReadStream}=await import('node:fs');
 const {execFile}=await import('node:child_process');
 const {promisify}=await import('node:util');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');
 const {tmpdir}=await import('node:os');
 const profile=await mkdtemp(join(tmpdir(),'prop-placement-'));t.after(()=>rm(profile,{recursive:true,force:true}));
 const data={map,prop,backgrounds,pin,published:{revision:1,assemblyId:id,officialRequestId:id,title:'굿상',map:{mapId:id},
  puzzles:[{...puzzle,scale:{table:100,bowl:150,well:100,lid:100}}]}};
 const html='<!doctype html><meta charset="utf-8"><ul id="items"></ul><main id="detail"></main><p id="result">running</p><script type="module">'+`
 import {mountWellAssembly} from '/well-assembly-ui.mjs';
 const {map,prop,backgrounds,pin,published}=${JSON.stringify(data)};
 const result=document.querySelector('#result'),calls=[];
 const until=async(pred,reason)=>{for(let i=0;i<50;i++){if(pred())return;await new Promise(r=>setTimeout(r,10));}throw Error(reason);};
 try{
  await mountWellAssembly({items:document.querySelector('#items'),detail:document.querySelector('#detail'),projectId:'binari',
   signal:new AbortController().signal,published,request:async path=>{
    const {pathname,searchParams}=new URL(path,location.origin);
    if(pathname.endsWith('/map-workspace'))return searchParams.has('item')?{map}:{maps:[{mapId:map.mapId,title:'굿터'}]};
    if(pathname.endsWith('/prop-workspace'))return searchParams.has('propId')?{prop}:{props:[{...pin,title:'물 그릇'}]};
    if(pathname.endsWith('/background-workspace'))return {backgrounds};
    throw Error('unexpected '+path);
   },submit:async body=>{calls.push(body);return new Response('{}',{status:202});}
  });
  document.querySelector('[data-preset=water]').click();
  const input=[...document.querySelectorAll('select[aria-label]')].find(el=>el.getAttribute('aria-label').endsWith('이미지 배율')&&el.closest('.well-assembly-role').querySelector('input').value==='150');
  await until(()=>Array.from(input.options).some(o=>o.value==='20'),'variant not offered');
  if(input.value!=='20'||Array.from(input.options).some(o=>!o.value))throw Error('legacy choice exposed or 20% not selected');
  await until(()=>document.querySelector('img[data-role=bowl]:not([hidden])')?.src.endsWith('scale-20'),'wrong preview');
  [...document.querySelectorAll('button')].find(n=>n.textContent==='변경 적용').click();
  await until(()=>calls.length===1,'file.update did not submit');
  const p=calls[0].payload.content.puzzles[0];
  if(p.bindings.bowl.imageScalePercent!==20||p.scale.bowl!==150||p.bindings.well.imageScalePercent!==20)throw Error('wrong saved variants');
  if(published.puzzles[0].bindings.bowl.imageScalePercent!==undefined)throw Error('published data mutated');
  result.textContent='PASS';
 }catch(e){result.textContent=e.message;}
 </script>`;
 const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(path.startsWith('/api/')){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>');return;}
  if(!/^\/[a-z0-9.-]+\.mjs$/.test(path)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type','text/javascript');createReadStream(new URL('../build'+path,import.meta.url)).on('error',()=>res.end()).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const {stdout}=await promisify(execFile)(process.env.CHROME_BIN,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking',
  '--no-first-run','--user-data-dir='+profile,'--virtual-time-budget=5000','--dump-dom','http://127.0.0.1:'+server.address().port+'/'],{timeout:30000,maxBuffer:1024*1024});
 assert.match(stdout,/<p id="result">PASS<\/p>/,stdout.match(/<p id="result">.*?<\/p>/)?.[0]);
});
