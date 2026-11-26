import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';

test('prop preview uses a shared scale on wide and narrow layouts',{skip:!process.env.CHROME_BIN},async t=>{
 const profile=await mkdtemp(join(tmpdir(),'prop-preview-size-'));
 t.after(()=>rm(profile,{recursive:true,force:true}));
 const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/local-project-page.css">
 <aside><div id="tools"></div><ul id="items"></ul></aside><main id="detail"></main><p id="result">running</p>
 <script type="module">
 import {mountPropWorkspace} from '/prop-workspace-ui.mjs';
 const el=id=>document.getElementById(id), item='test-prop';
 const prop={propId:item,title:'테스트',source:{revision:1},media:{
  detail:{url:'/api/prop-workspace?size=detail',width:1536,height:1024,mediaType:'image/png'},
  pixel:{url:'/api/prop-workspace?size=pixel',width:512,height:341,mediaType:'image/png'}}};
 const assert=(condition,error)=>{if(!condition)throw Error(error);};
 try{
 await mountPropWorkspace({items:el('items'),detail:el('detail'),tools:el('tools'),item,
  navigate:()=>'/test',request:async url=>url.includes('propId=')?{prop}:{props:[prop]}});
 const [detail,pixel]=document.querySelectorAll('.prop-preview-pair img');
 assert(detail&&pixel,'both images render');
 const [d,p]=[detail,pixel].map(img=>img.getBoundingClientRect());
 assert(d.width>0&&p.width>0&&Math.abs(d.width-3*p.width)<0.2,'widths use a shared scale: '+d.width+' / '+p.width);
 assert(Math.abs(d.y-p.y)<0.2,'images top-aligned');
 assert(Math.abs((d.height/p.height)-(1024/341))<0.06,'heights use a shared scale');
 assert(getComputedStyle(detail).imageRendering==='auto'&&getComputedStyle(pixel).imageRendering==='pixelated','pixel rendering isolation');
 assert(document.querySelector('[data-lane=detail] figcaption').textContent.includes('1536 × 1024 px'),'detail label');
 assert(document.querySelector('[data-lane=pixel] figcaption').textContent.includes('512 × 341 px'),'pixel label');
 assert(p.right<=el('detail').getBoundingClientRect().right+0.2,'no horizontal overflow');
 el('result').textContent='PASS';
 }catch(e){el('result').textContent=e.message;}
 </script>`;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(path==='/api/prop-workspace'){
   const [w,h]=url.searchParams.get('size')==='detail'?[1536,1024]:[512,341];
   res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"></svg>');return;
  }
  if(path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(!/^\/[a-z0-9.-]+\.(mjs|css)$/.test(path)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');
  createReadStream(new URL('../build'+path,import.meta.url)).on('error',()=>res.end()).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 for(const width of [900,500]){
  const {stdout}=await promisify(execFile)(process.env.CHROME_BIN,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking',
   '--no-first-run','--user-data-dir='+profile,'--window-size='+width+',800','--virtual-time-budget=5000','--dump-dom',
   'http://127.0.0.1:'+server.address().port+'/'],{timeout:30000,maxBuffer:1024*1024});
  assert.match(stdout,/<p id="result">PASS<\/p>/,stdout.match(/<p id="result">.*?<\/p>/)?.[0]);
 }
});
