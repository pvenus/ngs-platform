/** Install before the first case model; functions must belong to the iframe realm for Blazor. */
export function installEphemeralFrame(win,backing=new Map()){
 win.__ngsFrameValues=backing;
 const script=win.document.createElement('script');
 script.textContent=`(()=>{const values=window.__ngsFrameValues;const storage={get length(){return values.size;},key(i){return [...values.keys()][i]??null;},getItem(k){return values.get(String(k))??null;},setItem(k,v){values.set(String(k),String(v));},removeItem(k){values.delete(String(k));},clear(){values.clear();}};for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{configurable:true,get:()=>storage});window.__ngsMemoryStorageReady=storage.getItem instanceof Function;})();`;
 win.document.head.append(script);script.remove();
 if(win.__ngsMemoryStorageReady!==true||typeof win.localStorage.getItem!=='function')throw Error('메모리 전용 퍼즐 저장소를 준비하지 못했습니다.');
 const style=win.document.createElement('style');style.textContent='.host-header,footer{display:none!important}';win.document.head.append(style);
 return win.localStorage;
}
