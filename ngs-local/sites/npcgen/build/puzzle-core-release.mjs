import {puzzleCoreVersion,puzzleCoreFiles} from './puzzle-core-bundle.mjs';

export {puzzleCoreVersion};
const prefix='/puzzle-core/'+puzzleCoreVersion+'/_framework/';
export const puzzleCoreCsp="script-src 'self' 'wasm-unsafe-eval';";
const mime={js:'text/javascript; charset=utf-8',json:'application/json',wasm:'application/wasm',dll:'application/octet-stream'};
export function withPuzzleCore(html){
 if(typeof html!=='string'||!/<html lang="ko"(?=[ >])/u.test(html))throw Error('NGS_PUZZLE_HTML_INVALID');
 return html.replace('<html lang="ko"','<html lang="ko" data-puzzle-core="'+puzzleCoreVersion+'"');
}
export async function servePuzzleCore(path,method){
 const name=path?.startsWith(prefix)?path.slice(prefix.length):'';
 if(!Object.hasOwn(puzzleCoreFiles,name)||!['GET','HEAD'].includes(method))return null;
 const [sha,size,encoded]=puzzleCoreFiles[name];
 const headers={'Content-Type':mime[name.split('.').at(-1)],'Content-Length':String(size),
  'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=31536000, immutable'};
 if(method==='HEAD')return new Response(null,{headers});
 const compressed=Uint8Array.from(atob(encoded),ch=>ch.charCodeAt(0));
 const bytes=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(bytes.byteLength!==size||digest!==sha)throw Error('NGS_PUZZLE_BUNDLE_INTEGRITY_FAILED');
 return new Response(bytes,{headers});
}
