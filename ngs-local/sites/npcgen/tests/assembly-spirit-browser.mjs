import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';

test('Assembly toggles sight in place and preserves actor, position, inventory and held state',{skip:!process.env.CHROME_BIN},async t=>{
 const profile=await mkdtemp(join(tmpdir(),'assembly-spirit-'));
 t.after(()=>rm(profile,{recursive:true,force:true}));
 const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/local-project-page.css">
 <main id="host"></main><p id="result">running</p>
 <script type="module">
 import {mountWellPuzzleDemo} from '/well-puzzle-demo.mjs';
 const root=document.getElementById('host'),result=document.getElementById('result');
 const assert=(condition,error)=>{if(!condition)throw Error(error);};
 try{
 const roles=['table','bowl','well','lid'];
 const art=Object.fromEntries(roles.map(role=>[role,'/api/prop-workspace?lane=pixel&role='+role]));
 const artSizes=Object.fromEntries(roles.map(role=>[role,{width:30,height:20}]));
 const spiritArt=Object.fromEntries(roles.slice(0,-1).map(role=>[role,'/api/prop-workspace?lane=spirit&role='+role]));
 const mapRegions=[{id:'yard',name:'마당',description:'마당',backgroundId:'background.'+'a'.repeat(64),imageSha256:'b'.repeat(64)}];
 const regions=[{id:'yard',name:'마당',width:300,height:200,src:'/api/background-workspace?image=pixel',spiritSrc:'/api/background-workspace?image=cinematic'}];
 let changes=0;
 const controller=new AbortController();
 mountWellPuzzleDemo(root,{signal:controller.signal,rehearsal:{graph:{title:'테스트 맵',regions:mapRegions,startRegionId:'yard',startPoint:{x:230,y:390},connections:[]},regions,
  art,artSizes,spiritArt,initialRegion:'yard',connections:[],positions:{altar:{regionId:'yard',x:23,y:39},well:{regionId:'yard',x:78,y:39}},
  scale:Object.fromEntries(roles.map(role=>[role,100])),onPropChanged:()=>changes++}});
 const scene=root.querySelector('.well-demo-scene'),marker=root.querySelector('.assembly-actor'),bg=root.querySelector('.well-demo-map-bg');
 const toggle=root.querySelector('.well-spirit-toggle'),carried=root.querySelector('.well-demo-item');
 const table=root.querySelector('[data-role=table]'),lid=root.querySelector('[data-role=lid]');
 scene.focus();
 scene.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,code:'KeyF'}));
 assert(changes===1&&!carried.hidden,'pickup failed');
 carried.click();
 const styles=[scene.style.aspectRatio,marker.style.left,marker.style.top,table.style.width,table.style.height].join(',');
 toggle.click();
 assert(toggle.getAttribute('aria-pressed')==='true'&&bg.src.endsWith('cinematic')&&table.src.includes('lane=spirit'),'spirit art not applied together');
 assert(carried.querySelector('img').src.includes('lane=spirit')&&lid.src.includes('lane=pixel'),'inventory art or legacy fallback incorrect');
 assert(styles===[scene.style.aspectRatio,marker.style.left,marker.style.top,table.style.width,table.style.height].join(','),'actor or scale changed');
 assert(changes===1&&!carried.hidden&&carried.dataset.state==='empty'&&carried.getAttribute('aria-pressed')==='true','inventory state changed');
 assert(document.activeElement===scene&&scene.dataset.region==='yard'&&root.querySelector('.assembly-actor')===marker,'actor did not survive');
 toggle.click();
 assert(toggle.getAttribute('aria-pressed')==='false'&&bg.src.endsWith('pixel')&&table.src.includes('lane=pixel'),'pixel art was not restored');
 controller.abort();assert(!root.firstChild,'preview teardown failed');
 result.textContent='PASS';
 }catch(e){result.textContent=e.message;}
 </script>`;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(path.startsWith('/api/')){
   const [w,h]=path.includes('background')?[300,200]:[30,20];
   res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"></svg>');return;
  }
  if(path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(!/^\/[a-z0-9.-]+\.(mjs|css)$/.test(path)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');
  createReadStream(new URL('../build'+path,import.meta.url)).on('error',()=>res.end()).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const {stdout}=await promisify(execFile)(process.env.CHROME_BIN,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking',
   '--no-first-run','--user-data-dir='+profile,'--window-size=900,800','--virtual-time-budget=5000','--dump-dom',
   'http://127.0.0.1:'+server.address().port+'/'],{timeout:30000,maxBuffer:1024*1024});
  assert.match(stdout,/<p id="result">PASS<\/p>/,stdout.match(/<p id="result">.*?<\/p>/)?.[0]);
});
