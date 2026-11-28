// Expose only the exact frontend dependency closure already exposed by Space.
import {readFileSync} from 'node:fs';
import {withProductionAudio} from '../../space-hosting/overlay/build/shared-ngs-response.mjs';

const ui=new URL('../../ngs-local/sites/npcgen/build/',import.meta.url);
const spaceMap=new URL('../../space-hosting/overlay/build/shared-ngs-assets.ts',import.meta.url);
const text=(file,base)=>readFileSync(new URL(file,base),'utf8');
const moduleType='text/javascript; charset=utf-8';
export function viewerAssets(){
 const map=new Map(), source=withProductionAudio(text('local-project-page.html',ui));
 const tag='<script type="module" src="/local-project-page.js"></script>';
 const body='<body>';
 if(source.split(tag).length!==2||source.split(body).length!==2)throw Error('VIEWER_SHARED_UI_CONTRACT');
 const panel=`<aside class="viewer-panel" aria-label="NGS Viewer 동기화">
 <div class="viewer-panel-title"><strong>NGS Viewer</strong><span>팀원용 로컬 사본</span></div>
 <button id="viewer-link" type="button">Space 연결</button><button id="viewer-sync" type="button" disabled>P2 동기화</button>
 <span id="viewer-state" role="status" aria-live="polite">Space에 연결하면 요청과 파일 동기화를 사용할 수 있어요.</span>
 </aside>`;
 const html=source.replace(tag,'<link rel="stylesheet" href="/__viewer/style.css"><script type="module" src="/__viewer/browser.mjs"></script>')
   .replace(body,body+panel);
 map.set('/',{body:html,type:'text/html; charset=utf-8'});
 const allow=readFileSync(spaceMap,'utf8');
 for(const [,file] of allow.matchAll(/^import \w+ from "\.\.\/ngs-local\/sites\/npcgen\/build\/([a-z0-9-]+\.(?:html|mjs|css|js))\?raw";$/gm)){
  if(file.endsWith('.html'))continue;
  map.set('/'+file,{body:text(file,ui),type:file.endsWith('.css')?'text/css; charset=utf-8':moduleType});
 }
 if(!map.has('/local-project-page.js')||!map.has('/local-project-page.css'))throw Error('VIEWER_SHARED_ASSETS_MISSING');
 for(const [url,file,type] of [['/__viewer/browser.mjs','browser.mjs',moduleType],['/__viewer/style.css','style.css','text/css; charset=utf-8']])
  map.set(url,{type,body:text(file,new URL('../public/',import.meta.url))});
 // The source-only repository does not ship the licensed Space wordmark.
 map.set('/assets/vinus-mark.png',{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#272636"/><path d="M10 13h8l6 19 6-19h8L27 38h-6z" fill="#e8e1fa"/></svg>'});
 return map;
}
