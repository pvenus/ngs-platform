import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,writeFile,chmod,link,symlink,rm,realpath} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {configuration,createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {openPuzzleBundle,puzzlePrefix} from '../build/local-puzzle-media.mjs';

const still=['home','shoulders','yard','shoes','room','ribbon','doll','candle'].map(s=>s+'.webp');
const films=['ignition','doll-dissolve','ribbon-dissolve','bowed','ending'].map(s=>s+'.mp4');
const wave='intro-loop.wav',listed=[...still,...films,wave];
const magic={webp:'RIFF....WEBP',wav:'RIFF....WAVE',mp4:'....ftypmp42'};
const bytes=name=>Buffer.from(magic[name.split('.').at(-1)]+'-------fixture payload');
async function files(t){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'ngs-puzzle-fixture-')));
 t.after(()=>rm(temp,{recursive:true,force:true}));
 const root=join(temp,'project'),media=join(temp,'private-media');
 await mkdir(media,{mode:0o700});
 for(const name of listed)await writeFile(join(media,name),bytes(name),{mode:0o600});
 return {root,media,temp};
}
async function start(t,options){
 const server=createLocalProjectPageServer(options);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return 'http://127.0.0.1:'+server.address().port;
}
const from=(origin,route,options={})=>fetch(origin+route,{redirect:'manual',...options});
test('native Mac composition chooses only the exact private default; explicit root or empty wins',()=>{
 const exact=fileURLToPath(new URL('../build/local-miniflare-app.mjs',import.meta.url));
 const native={platform:'darwin',entryPoint:exact};
 assert.equal(configuration({}).localPuzzleMediaRoot,undefined,'ordinary test fixture never implicitly opens real media');
 assert.equal(configuration({},native).localPuzzleMediaRoot,
  join(homedir(),'Workspaces','NGS','runtime','puzzle-design-assets','binari-bad-ending-v1'));
 for(const options of [{platform:'linux',entryPoint:exact},{platform:'darwin',entryPoint:exact+'.other'},
  {platform:'darwin',entryPoint:'/different/release/local-miniflare-app.mjs'}])
  assert.equal(configuration({},options).localPuzzleMediaRoot,undefined);
 assert.equal(configuration({NGS_LOCAL_PUZZLE_MEDIA_ROOT:''},native).localPuzzleMediaRoot,'');
 assert.equal(configuration({NGS_LOCAL_PUZZLE_MEDIA_ROOT:'/exact/private/choice'},native).localPuzzleMediaRoot,'/exact/private/choice');
});

test('absent or invalid private root does not open the puzzle or change audio marker',async t=>{
 const {root,media}=await files(t);
 await chmod(media,0o755);
 for(const localPuzzleMediaRoot of [undefined,media]){
  const origin=await start(t,{root,localPuzzleMediaRoot,audioWorkspaceEnabled:true});
  const html=await (await from(origin,'/')).text();
  assert.match(html,/data-audio-workspace="enabled"/);
  assert.doesNotMatch(html,/data-puzzle-workspace/);
  assert.match(html,/data-well-puzzle-demo="enabled"/);
  for(const path of ['/well-puzzle-demo.mjs','/puzzle-state-runtime.mjs'])
   assert.equal((await from(origin,path)).status,200);

  assert.equal((await from(origin,puzzlePrefix)).status,404);
 }
});
test('configured NGS Local exposes only one authorized puzzle, exact code and bounded media',async t=>{
 const {root,media}=await files(t);
 await writeFile(join(media,'extra.txt'),'should never be served',{mode:0o600});
 const config=configuration({NGS_PROJECT_CATALOG_ROOT:root,NGS_LOCAL_PUZZLE_MEDIA_ROOT:media,NGS_AUDIO_WORKSPACE_ENABLED:'1'});
 assert.equal(config.localPuzzleMediaRoot,media);
 const origin=await start(t,config);
 const base=await from(origin,'/'),html=await base.text();
 assert.equal(base.headers.get('X-Frame-Options'),'DENY');
 assert.match(html,/data-audio-workspace="enabled" data-puzzle-workspace="enabled"/);
 assert.equal((await from(origin,puzzlePrefix)).status,401);
 assert.equal((await from(origin,puzzlePrefix+'assets/ending.mp4')).status,401);
 const session=await from(origin,'/__npcgen_session');
 const auth={Cookie:session.headers.get('Set-Cookie').split(';')[0]};
 const read=(path,opts={})=>from(origin,puzzlePrefix+path,{...opts,headers:{...auth,...opts.headers}});
 const page=await read('');
 assert.equal(page.status,200);
 assert.equal(page.headers.get('X-Frame-Options'),'SAMEORIGIN');
 assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'self'/);
 assert.match(await page.text(),/빈 마루에 바람이 앉으면/);
 const collector=await read('v28-pointer-collector.js');
 assert.equal(collector.status,200);
 assert.equal(createHash('sha256').update(Buffer.from(await collector.arrayBuffer())).digest('hex'),
  '250e141469b19e4d501ae096e6be286b82051bb9e2cbb66f82629a3609946bed');
 for(const code of ['play.css','play.mjs','scene-input.mjs','ending-state.mjs'])
  assert.equal((await read(code)).status,200);
 for(const name of listed){
  const head=await read('assets/'+name,{method:'HEAD'});
  assert.equal(head.status,200);
  assert.equal(Number(head.headers.get('Content-Length')),bytes(name).length);
 }
 const film=await read('assets/ending.mp4',{headers:{Range:'bytes=4-11'}});
 assert.equal(film.status,206);
 assert.equal(film.headers.get('Content-Type'),'video/mp4');
 assert.equal(film.headers.get('Content-Range'),`bytes 4-11/${bytes('ending.mp4').length}`);
 assert.deepEqual(Buffer.from(await film.arrayBuffer()),bytes('ending.mp4').subarray(4,12));
 const clip=await read('assets/intro-loop.wav',{headers:{Range:'bytes=-5'}});
 assert.equal(clip.status,206);
 assert.deepEqual(Buffer.from(await clip.arrayBuffer()),bytes(wave).subarray(-5));
 for(const range of ['bytes=1000-','bytes=0-1,4-5']){
  const response=await read('assets/ending.mp4',{headers:{Range:range}});
  assert.equal(response.status,416);
 }
 for(const path of ['assets/extra.txt','assets/%65nding.mp4','assets/ending.mp4?anything=1','not-play.mjs'])
  assert.equal((await read(path)).status,404);
 assert.equal((await read('assets/ending.mp4',{headers:{'Sec-Fetch-Site':'same-site'}})).status,403);
 assert.equal((await read('assets/ending.mp4',{method:'POST',headers:{Origin:origin}})).status,405);
 assert.equal((await from(origin,'/api/production-sets',{headers:auth})).status,404);
 await writeFile(join(media,'ending.mp4'),bytes('ending.mp4'));
 assert.equal((await read('assets/ending.mp4')).status,404,'changed media pin must never stream');
});
test('wrong format, symlinks, hardlinks and nonprivate member all fail bundle validation',async t=>{
 const {media,temp}=await files(t),file=join(media,'home.webp'),source=join(temp,'other.webp');
 assert.ok(openPuzzleBundle(media));
 await writeFile(source,bytes('home.webp'),{mode:0o600});
 await chmod(file,0o640);assert.equal(openPuzzleBundle(media),null);
 await rm(file);await symlink(source,file);assert.equal(openPuzzleBundle(media),null);
 await rm(file);await link(source,file);assert.equal(openPuzzleBundle(media),null);
 await rm(file);await writeFile(file,Buffer.from('not a correct WEBP!'),{mode:0o600});assert.equal(openPuzzleBundle(media),null);
 assert.equal(await readFile(source,'utf8'),bytes('home.webp').toString());
});
