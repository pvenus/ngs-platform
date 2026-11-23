const rect=(x,y,width,height)=>({x,y,width,height});
const target=(id,kind,label,box)=>({id,kind,label,rect:rect(...box)});
const back=target('room','move','방 둘러보기',[.012,.845,.23,.13]);
export const initial=()=>({node:'home',sequence:0,seen:[],locked:false});
const fixed={
 home:[target('walk','move','문간으로 가기',[.060,.32,.26,.55])],
 shoulders:[target('yard','move','마당으로 가기',[.51,.31,.38,.52])],
 yard:[target('room','move','방으로 들어가기',[.48,.36,.37,.32]),target('shoes','inspect','마당의 신발 보기',[.49,.70,.28,.23])],
 shoes:[target('yard','move','마당 둘러보기',[.015,.84,.28,.14])],
 room:[target('ribbon','inspect','머리끈 살피기',[.025,.29,.29,.31]),target('doll','inspect','인형 살피기',[.72,.42,.27,.47]),target('candle','inspect','꺼진 초 살피기',[.48,.44,.22,.27])],
 ribbon:[back],doll:[back],candle:[back]
};
export function targets(s) {
 if(s.locked)return [];
 if(s.node==='candle'&&s.seen.includes('ribbon')&&s.seen.includes('doll'))
  return [...fixed.candle,target('light','inspect','초에 불 붙이기',[.53,.51,.33,.42])];
 return fixed[s.node]??[];
}
export function act(s,id) {
 if(!targets(s).some(t=>t.id===id))return s;
 let node=id,seen=s.seen;
 if(id==='walk')node='shoulders';
 if(id==='light')node='ignition';
 if((id==='ribbon'||id==='doll')&&!seen.includes(id))seen=[...seen,id];
 return {...s,node,seen,locked:id==='light',sequence:s.sequence+1};
}
export const aftermath=Object.freeze(['ignition','doll-dissolve','ribbon-dissolve','bowed','ending']);
export function nextAftermath(s) {
 if(!s.locked)return s;
 const at=aftermath.indexOf(s.node);
 if(at<0||at>=aftermath.length-1)return s;
 return {...s,node:aftermath[at+1],sequence:s.sequence+1};
}
