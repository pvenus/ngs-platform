import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {canonicalPropPackage,parsePropPackage,projectPropPlayer,propPackageReceipt,resolvePropPlayback,verifyPropMedia,listPublishedPropPointers,propAssetPath,propManifestPath,propPointerPath,validatePropSuccessor} from '../build/prop-package-contract.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex'),phase=[42,42,41];
const pngMagic=Buffer.from('89504e470d0a1a0a','hex');
const u32=v=>{const b=Buffer.alloc(4);b.writeUInt32BE(v);return b;};
function chunk(k,value){
 const b=Buffer.concat([Buffer.from(k),value]);
 return Buffer.concat([u32(value.length),b,u32(crc32(b))]);
}
function giflikePng(w,h,{times=[],opaque=false,blank=false,rgb=false,wrongLoop=false,shortFrame=false,rowFilter=0}={}){
 const rowSize=1+w*(rgb?3:4);
 const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=rgb?2:6;
 const list=[pngMagic,chunk('IHDR',header)];
 if(times.length)list.push(chunk('acTL',Buffer.concat([u32(times.length),u32(wrongLoop?0:1)])));
 let order=0;
 for(let f=0;f<(times.length||1);f++){
  const raw=Buffer.alloc(rowSize*h);
  for(let y=0;y<h;y++){
   for(let x=0;x<w;x++){
    const idx=y*rowSize+1+(rgb?3:4)*x;
    raw[idx]=40+f;raw[idx+1]=50;raw[idx+2]=60;
    if(!rgb)raw[idx+3]=blank?0:opaque||x>=w/2?255:0;
   }
  }
  if(rowFilter===1)for(let y=0;y<h;y++){
   const start=y*rowSize;raw[start]=1;
   for(let x=rowSize-1;x>4;x--)raw[start+x]=(raw[start+x]-raw[start+x-4])&255;
  }
  if(times.length){
   const ctrl=Buffer.alloc(26);
   ctrl.writeUInt32BE(order++);ctrl.writeUInt32BE(w-(shortFrame&&f===1?1:0),4);ctrl.writeUInt32BE(h,8);
   ctrl.writeUInt16BE(times[f],20);ctrl.writeUInt16BE(1000,22);list.push(chunk('fcTL',ctrl));
  }
  list.push(f?chunk('fdAT',Buffer.concat([u32(order++),deflateSync(raw)])):chunk('IDAT',deflateSync(raw)));
 }
 list.push(chunk('IEND',Buffer.alloc(0)));
 return Buffer.concat(list);
}
function media(b,w,h,times){
 const sha256=sha(b);
 return {assetId:sha256+'.png',sha256,width:w,height:h,bytes:b.length,mediaType:times.length?'image/apng':'image/png',frameDurationsMs:[...times]};
}
function fixture(times=phase){
 const baseDetail=giflikePng(32,32,{rowFilter:1}),basePixel=giflikePng(16,16);
 const detail=giflikePng(32,32,{times,rowFilter:1}),pixel=giflikePng(16,16,{times});
 const pack={schemaVersion:'ngs.prop-package.v1',projectId:'binari',propId:'candle.small',revision:1,parentSha256:null,
  officialRequestId:'request.official.'+'1'.repeat(64),requestSha256:'2'.repeat(64),designContextSha256:'3'.repeat(64),
  title:'촛불',media:{detail:media(baseDetail,32,32,[]),pixel:media(basePixel,16,16,[])},
  interaction:{pixelOpen:{action:'open',x:2,y:3,width:8,height:9},detailTrigger:{action:'activate',x:4,y:8,width:16,height:18}},
  animations:times.length?[{id:'initial',title:'초기 움직임',officialRequestId:'request.official.'+'1'.repeat(64),requestSha256:'2'.repeat(64),
   media:{detail:media(detail,32,32,times),pixel:media(pixel,16,16,times)}}]:[]};
 return {pack,detail,pixel,baseDetail,basePixel};
}

test('fixed canonical manifest receipt is property-order stable and bound to normalized fields',async()=>{
 const {pack}=fixture();
 const rev=Object.fromEntries(Object.entries(pack).reverse());
 const expected=sha(canonicalPropPackage(pack));
 assert.equal(await propPackageReceipt(pack),'prop.package.'+expected);
 assert.equal(await propPackageReceipt(rev),await propPackageReceipt(pack));
 assert.notEqual(await propPackageReceipt({...pack,title:'새 촛불'}),await propPackageReceipt(pack));
 for(const invalid of [{...pack,localRoot:'/tmp/x'},{...pack,placement:{x:.2,y:.3}},
  {...pack,media:{...pack.media,detail:{...pack.media.detail,url:'https://example.net/input'}}},
  {...pack,interaction:{...pack.interaction,pixelOpen:{action:'open',x:10,y:10,width:16,height:8}}},
  {...pack,interaction:{...pack.interaction,detailTrigger:{...pack.interaction.detailTrigger,action:'script'}}},
  {...pack,animations:[{...pack.animations[0],media:{...pack.animations[0].media,pixel:{...pack.animations[0].media.pixel,frameDurationsMs:[41,42,42]}}}]},
  {...pack,animations:[pack.animations[0],pack.animations[0]]},
  {...pack,animations:[{...pack.animations[0],officialRequestId:'request.official.'+'a'.repeat(64)}]},
  {...pack,parentSha256:'9'.repeat(64)}])assert.throws(()=>parsePropPackage(invalid),/PROP_PACKAGE_/);
});
test('media verifier detects real alpha, actual APNG per-frame evidence, motion and byte mismatch',async()=>{
 const {pack,detail,pixel}=fixture();
 await verifyPropMedia(detail,pack.animations[0].media.detail);
 await verifyPropMedia(pixel,pack.animations[0].media.pixel);
 assert(await verifyPropMedia(fixture([]).pixel,fixture([]).pack.media.pixel));
 const cases=[
  [giflikePng(16,16,{times:phase,opaque:true}),'ALPHA_CONTENT'],
  [giflikePng(16,16,{times:phase,blank:true}),'ALPHA_CONTENT'],
  [giflikePng(16,16,{times:phase,rgb:true}),'RGBA_REQUIRED'],
  [giflikePng(16,16,{times:phase,wrongLoop:true}),'APNG_CONTROL'],
  [giflikePng(16,16,{times:phase,shortFrame:true}),'APNG_FRAME'],
  [giflikePng(16,16,{times:[41,42,42]}),'APNG_FRAME'],
  [giflikePng(16,16),'PNG_DATA']
 ];
 for(const [bytes,code] of cases)await assert.rejects(verifyPropMedia(bytes,media(bytes,16,16,phase)),new RegExp(code));
 const crc=Buffer.from(pixel);crc[29]^=1;
 await assert.rejects(verifyPropMedia(crc,media(crc,16,16,phase)),/PNG_CRC/);
 await assert.rejects(verifyPropMedia(crc,pack.animations[0].media.pixel),/MEDIA_HASH/);
});
test('runtime honors exact older version and selected clip without fetching other animations',async()=>{
 const original=fixture();
 const {detail,pixel,baseDetail,basePixel}=original;
 const otherTimes=[50,50],otherDetail=giflikePng(32,32,{times:otherTimes}),otherPixel=giflikePng(16,16,{times:otherTimes});
 const pack={...original.pack,revision:2,parentSha256:(await propPackageReceipt(original.pack)).slice(-64),
  officialRequestId:'request.official.'+'4'.repeat(64),
  animations:[...original.pack.animations,{id:'unselected',title:'선택되지 않음',officialRequestId:'request.official.'+'4'.repeat(64),
   requestSha256:original.pack.requestSha256,media:{detail:media(otherDetail,32,32,otherTimes),pixel:media(otherPixel,16,16,otherTimes)}}]};
 const hash=(await propPackageReceipt(pack)).slice(-64);
 const ref={propId:pack.propId,revision:pack.revision,sha256:hash};
 const clip=pack.animations[0].media;
 const binding={propRef:ref,placement:{x:.38,y:.64},start:'manual',animationId:'initial'};
 const assets=new Map([[pack.media.detail.assetId,baseDetail],[pack.media.pixel.assetId,basePixel],
  [clip.detail.assetId,detail],[clip.pixel.assetId,pixel]]);
 const ids=[];
 const readAsset=async p=>{
  assert.deepEqual({projectId:p.projectId,propId:p.propId,revision:p.revision,sha256:p.sha256},{projectId:'binari',...ref});
  ids.push(p.assetId);return assets.get(p.assetId);
 };
 const verified=await resolvePropPlayback({puzzleBinding:binding,readPackage:async pin=>{
  assert.deepEqual(pin,{projectId:'binari',...ref});return pack;},readAsset});
 assert.deepEqual(ids,[...assets.keys()]);
 const projection=projectPropPlayer(verified);
 assert.deepEqual(projection,{schemaVersion:'ngs.prop-player-input.v1',propRef:ref,placement:{x:.38,y:.64},start:'manual',animationId:'initial',
  playback:{frameDurationsMs:phase,pixel:{assetId:pack.media.pixel.assetId,animationAssetId:clip.pixel.assetId,width:16,height:16,hotspot:pack.interaction.pixelOpen},
  detail:{assetId:pack.media.detail.assetId,animationAssetId:clip.detail.assetId,width:32,height:32,hotspot:pack.interaction.detailTrigger}}});
 const bad=async()=>{throw Error('unexpected media call');};
 await assert.rejects(resolvePropPlayback({puzzleBinding:binding,readPackage:async()=>({...pack,revision:3,parentSha256:'7'.repeat(64)}),readAsset:bad}),/PIN_MISMATCH/);
 await assert.rejects(resolvePropPlayback({puzzleBinding:binding,readPackage:async()=>({...pack,projectId:'other'}),readAsset:bad}),/PACKAGE_INVALID/);
 await assert.rejects(resolvePropPlayback({puzzleBinding:{...binding,start:'shell'},readPackage:bad,readAsset:bad}),/PUZZLE_BINDING/);
 await assert.rejects(resolvePropPlayback({puzzleBinding:{...binding,animationId:'newer'},readPackage:async()=>pack,readAsset:bad}),/ANIMATION_MISSING/);
 await assert.rejects(resolvePropPlayback({puzzleBinding:binding,readPackage:async()=>pack,readAsset:async()=>detail}),/MEDIA_HASH/);
 const still=projectPropPlayer(await resolvePropPlayback({puzzleBinding:{...binding,animationId:null},readPackage:async()=>pack,readAsset}));
 assert.throws(()=>projectPropPlayer({package:pack,binding,media:{}}),/PLAYBACK_UNVERIFIED/);
 verified.binding.placement.x=99;
 assert.equal(projectPropPlayer(verified).placement.x,.38);
 assert.deepEqual(still.playback.frameDurationsMs,[]);
 assert.equal(still.playback.detail.animationAssetId,null);
});
test('non-preset single animation appends a revision without dropping or modifying existing clip, media or interaction',async()=>{
 const {pack}=fixture(),parentSha256=(await propPackageReceipt(pack)).slice(-64);
 const officialRequestId='request.official.'+'a'.repeat(64),requestSha256='b'.repeat(64);
 const appended={...pack.animations[0],id:'wind-gust',title:'바람에 흔들림',officialRequestId,requestSha256};
 const next={...pack,revision:2,parentSha256,officialRequestId,requestSha256,animations:[...pack.animations,appended]};
 const proof={operation:'append-animation',animationId:'wind-gust'};
 assert.deepEqual(await validatePropSuccessor(pack,next,proof),parsePropPackage(next));
 await assert.rejects(validatePropSuccessor(pack,{...next,parentSha256:'0'.repeat(64)},proof),/PREDECESSOR/);
 await assert.rejects(validatePropSuccessor(pack,{...next,animations:[appended]},proof),/PRESERVATION/);
 await assert.rejects(validatePropSuccessor(pack,{...next,title:'부주의한 편집'},proof),/PRESERVATION/);
 await assert.rejects(validatePropSuccessor(pack,{...next,animations:[...pack.animations,{...appended,requestSha256:'6'.repeat(64)}]},proof),/LINEAGE/);
 await validatePropSuccessor(pack,{...next,title:'설명만 편집',animations:pack.animations},{operation:'edit',editScope:'metadata'});
 await assert.rejects(validatePropSuccessor(pack,next,{operation:'edit',editScope:'metadata'}),/PRESERVATION/);
 const alternate=media(giflikePng(16,16,{rowFilter:1}),16,16,[]);
 const appearance={...next,media:{...pack.media,pixel:alternate},animations:pack.animations};
 await assert.rejects(validatePropSuccessor(pack,appearance,{operation:'edit',editScope:'metadata'}),/EDIT_SCOPE/);
 await validatePropSuccessor(pack,appearance,{operation:'edit',editScope:'appearance'});
});
test('canonical folder listing reads small exact pointers only and derives safe immutable paths',async()=>{
 const sha256='1'.repeat(64),contacts=[];
 assert.equal(propManifestPath('candle.small',9),'canonical-files/binari/props/candle.small/releases/9/manifest.json');
 assert.equal(propAssetPath('candle.small',sha256+'.png'),'canonical-files/binari/props/candle.small/assets/'+sha256+'.png');
 for(const v of ['../npcs','/tmp','candle%2Fsmall','candle.small/../other'])assert.throws(()=>propPointerPath(v),/PATH/);
 const pointers=await listPublishedPropPointers({listPropFolders:async x=>{
  assert.deepEqual(x,{projectId:'binari',prefix:'canonical-files/binari/props/'});return ['draft-only','candle.small'];},
  readPointer:async x=>{
   contacts.push(x.path);
   return x.propId==='draft-only'?null:{schemaVersion:'ngs.prop-pointer.v1',projectId:x.projectId,propId:x.propId,
    title:'촛불',revision:9,sha256};
  }});
 assert.deepEqual(contacts,['canonical-files/binari/props/candle.small/metadata.json','canonical-files/binari/props/draft-only/metadata.json']);
 assert.deepEqual(pointers.map(x=>x.propId),['candle.small']);
});
test('Local and Space wire the identical portable browser source, not two runtime implementations',()=>{
 const root=new URL('../../../..',import.meta.url);
 const local=readFileSync(new URL('ngs-local/sites/npcgen/build/local-project-page-server.mjs',root),'utf8');
 const space=readFileSync(new URL('space-hosting/overlay/build/shared-ngs-assets.ts',root),'utf8');
 assert.match(local,/\/prop-package-contract\.mjs[^\n]*new URL\('\.\/prop-package-contract\.mjs'/u);
 assert.match(space,/import propPackageContract from "\.\.\/ngs-local\/sites\/npcgen\/build\/prop-package-contract\.mjs\?raw"/u);
 assert.match(space,/\/prop-package-contract\.mjs", \{type: javascript, body: propPackageContract\}/u);
});
