export function requestNavigationIndex(key,index,length){
 if(!length)return null;
 return key==='ArrowDown'?Math.min(length-1,index+1):key==='ArrowUp'?Math.max(0,index-1):key==='Home'?0:key==='End'?length-1:null;
}
