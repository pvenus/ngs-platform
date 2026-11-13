import {ApiError} from './contracts';
export const TOTAL_LIMIT=24*1024*1024;
export function inspectMedia(b:Uint8Array):'image/png'|'video/mp4'{
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 if(b.length>=33&&b.slice(0,8).every((n,i)=>n===[137,80,78,71,13,10,26,10][i])){
  if(b.length>5*1024*1024)throw new ApiError('ATTACHMENT_SIZE_INVALID',413);
  if(v.getUint32(8)!==13||String.fromCharCode(...b.slice(12,16))!=='IHDR'||!v.getUint32(16)||v.getUint32(16)>4096||!v.getUint32(20)||v.getUint32(20)>4096||b[24]!==8||![0,2,4,6].includes(b[25])||b[26]||b[27]||b[28])throw new ApiError('PNG_FORMAT_UNSUPPORTED',400);return 'image/png';
 }
 if(b.length<16||b.length>20*1024*1024)throw new ApiError('MEDIA_FORMAT_OR_SIZE_INVALID',400);
 const word=(pos:number)=>String.fromCharCode(...b.slice(pos,pos+4));const seen=new Set<string>();let track=false;
 function boxes(start:number,end:number,depth=0){if(depth>6)throw new ApiError('MP4_INVALID',400);let pos=start;
  while(pos<end){if(end-pos<8)throw new ApiError('MP4_TRUNCATED',400);let n=v.getUint32(pos),header=8;const kind=word(pos+4);
   if(n===1){if(end-pos<16)throw new ApiError('MP4_TRUNCATED',400);const size=v.getBigUint64(pos+8);if(size>BigInt(end-pos))throw new ApiError('MP4_BOX_INVALID',400);n=Number(size);header=16;}
   if(n<header||pos+n>end)throw new ApiError('MP4_BOX_INVALID',400);
   if(depth===0){if(kind==='moof')throw new ApiError('FRAGMENTED_MP4_UNSUPPORTED',400);if(kind==='ftyp'&&(pos!==0||n-header<8||n-header>256||(n-header)%4||!['isom','iso2','iso3','iso4','iso5','iso6','mp41','mp42','avc1'].includes(word(pos+header))))throw new ApiError('MP4_BRAND_UNSUPPORTED',400);if(kind==='mdat'&&n<=header)throw new ApiError('MP4_EMPTY_MEDIA',400);seen.add(kind);}
   if(kind==='trak')track=true;if(['moov','trak','mdia','minf','stbl','dinf','edts'].includes(kind))boxes(pos+header,pos+n,depth+1);pos+=n;
  }
 }
 boxes(0,b.length);if(!['ftyp','moov','mdat'].every(k=>seen.has(k))||!track)throw new ApiError('MP4_REQUIRED_BOX_MISSING',400);return 'video/mp4';
}
