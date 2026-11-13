'use client';
import {useEffect,useState} from 'react';
import {textValue,type RecordData} from './adapter';
/** Bounded table and one full selected rule, including unknown source fields. */
export function NpcRules({rules,onView}:{rules:RecordData[];onView?:(rule:RecordData,index:number)=>void}){
 const [selected,setSelected]=useState(0),[page,setPage]=useState(0),size=5,pages=Math.ceil(rules.length/size),current=rules[selected];
 useEffect(()=>{setSelected(0);setPage(0);},[rules.map(r=>String(r.id)).join('|')]);
 if(!rules.length)return <p>등록된 항목 없음</p>;
 const labels:Record<string,string>={id:'ID',mode:'원칙 종류',priority:'우선순위',condition:'조건',action:'행동'};
 return <div className="npc-rules"><div className="npc-compact-table-wrap"><table className="npc-compact-table"><caption>판단 원칙 · {rules.length}개</caption><thead><tr><th>순위</th><th>조건 · 행동</th><th>상세</th></tr></thead><tbody>{rules.slice(page*size,(page+1)*size).map((r,i)=>{const index=page*size+i;return <tr key={index} className={index===selected?'selected':''}><td>{textValue(r.priority)}</td><td><span className="npc-rule-excerpt">{textValue(r.condition)}</span><span className="npc-rule-excerpt npc-rule-action">{textValue(r.action)}</span></td><td><button type="button" aria-pressed={index===selected} onClick={()=>{setSelected(index);onView?.(r,index);}} aria-label={`원칙 ${index+1} 상세`}>보기</button></td></tr>;})}</tbody></table></div>{pages>1&&<div className="npc-rule-pages"><button type="button" disabled={!page} onClick={()=>{setPage(page-1);setSelected((page-1)*size);}}>이전 원칙</button><span>{page+1} / {pages}</span><button type="button" disabled={page+1>=pages} onClick={()=>{setPage(page+1);setSelected((page+1)*size);}}>다음 원칙</button></div>}{!onView&&<div className="npc-rule-support" tabIndex={0} role="region" aria-label="선택한 판단 원칙 전문"><table className="npc-compact-table"><caption>선택한 원칙 · 전체 내용</caption><tbody>{Object.entries(current||{}).map(([key,value])=><tr key={key}><th scope="row">{labels[key]||key}</th><td>{textValue(value)}</td></tr>)}</tbody></table></div>}</div>;
}
