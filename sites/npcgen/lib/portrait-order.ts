/** View order only. Published portraits have no per-image generation timestamp.
 * Use the batch's NPC save time, then request creation time; legacy batches use
 * append order. Keep slots together even when outputs complete out of order. */
export function portraitGroups<T extends {assetId?:unknown;sourceRef?:unknown}>(portraits:readonly T[],origins:Record<string,any>={ }):{id:string;legacy:boolean;items:T[]}[]{
 const groups=new Map<string,{id:string;legacy:boolean;time:number|null;last:number;items:{portrait:T;position:number;slot:number|null}[]}>();
 const timestamp=(value:unknown):number|null=>{const n=typeof value==='number'?value:typeof value==='string'&&value.trim()?Date.parse(value):NaN;return Number.isFinite(n)&&n>0?n:null;};
 portraits.forEach((portrait,position)=>{
  const source=String(portrait.sourceRef??''),origin=origins[String(portrait.assetId)],request=origin?.request;
  const batch=source.match(/(?:^|;)request:([^;]+)/)?.[1]||source.match(/(?:^|;)run:(.+)\.\d+(?:;|$)/)?.[1],key=batch||String(portrait.assetId);
  const group=groups.get(key)||{id:key,legacy:!batch,time:null,last:position,items:[]};
  const time=timestamp(request?.portraitResult?.publicationEvidence?.savedAt)??timestamp(request?.createdAt);
  if(time!==null)group.time=Math.max(group.time??time,time);
  const index=origin?.output?.index,runSlot=source.match(/(?:^|;)run:[^;]+\.(\d+)(?:;|$)/)?.[1];
  const slot=Number.isInteger(index)&&index>=0?index:runSlot?Number(runSlot)-1:null;
  group.last=position;group.items.push({portrait,position,slot});groups.set(key,group);
 });
 return [...groups.values()].sort((a,b)=>(b.time??-Infinity)-(a.time??-Infinity)||b.last-a.last).map(group=>({id:group.id,legacy:group.legacy,items:group.items.sort((a,b)=>(a.slot??a.position)-(b.slot??b.position)||a.position-b.position).map(item=>item.portrait)}));
}

export function latestPortraits<T extends {assetId?:unknown;sourceRef?:unknown}>(portraits:readonly T[],origins:Record<string,any>={}):T[]{return portraitGroups(portraits,origins).flatMap(group=>group.items);}
/** Three rows of three; incomplete batches keep their own row. Adjacent legacy
 * singletons share a presentation row only. A group never crosses a page. */
export function portraitPages<T extends {assetId?:unknown;sourceRef?:unknown}>(portraits:readonly T[],origins:Record<string,any>={}){
 const groups=portraitGroups(portraits,origins),packed:typeof groups=[];
 for(const group of groups){const last=packed.at(-1);if(group.legacy&&last?.legacy&&last.items.length<3)last.items.push(...group.items);else packed.push({...group,items:[...group.items]});}
 const pages:(typeof groups)[]=[];let current:typeof groups=[],rowCount=0;
 for(const group of packed){const count=Math.ceil(group.items.length/3);if(current.length&&rowCount+count>3){pages.push(current);current=[];rowCount=0;}current.push(group);rowCount+=count;}
 if(current.length)pages.push(current);return pages;
}
export function portraitPageNumbers(current:number,total:number):(number|'gap')[]{
 const values=total<=7?Array.from({length:total},(_,i)=>i+1):[1,...Array.from({length:3},(_,i)=>current+i).filter(n=>n>1&&n<total),total];
 const result:(number|'gap')[]=[];for(const value of [...new Set(values)].sort((a,b)=>a-b)){const previous=result.at(-1);if(typeof previous==='number'&&value-previous===2)result.push(previous+1);else if(typeof previous==='number'&&value-previous>2)result.push('gap');result.push(value);}return result;
}
