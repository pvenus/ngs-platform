'use client';
import {useEffect,useRef,type ReactNode,type KeyboardEvent} from 'react';

export type HierarchyItem={id:string;title:ReactNode;meta?:ReactNode};
/** Story and NPC scopes share the same navigation, layout and reveal behavior. */
export function HierarchyNavigation({level,label,items,selected,onSelect,actions,children,empty='등록된 항목이 없습니다.',regionLabel}:{regionLabel?:string;level:'act'|'chapter';label:string;items:HierarchyItem[];selected:string;onSelect:(id:string)=>void;actions?:ReactNode;children?:ReactNode;empty?:string}){
 const nav=useRef<HTMLElement>(null);
 useEffect(()=>{const element=nav.current;if(!element)return;function reveal(){const button=element?.querySelector<HTMLElement>('[aria-pressed="true"],[aria-current="true"]');if(!button||!element)return;const a=element.getBoundingClientRect(),b=button.getBoundingClientRect();if(b.left<a.left)element.scrollBy({left:b.left-a.left});else if(b.right>a.right)element.scrollBy({left:b.right-a.right});}reveal();const observer=new ResizeObserver(reveal);observer.observe(element);return()=>observer.disconnect();},[selected]);
 return <section className={`surface concept-navigation ${level==='act'?'concept-top-controls concept-fixed-group-controls':'concept-area-controls story-chapter-controls'}`} aria-label={regionLabel||(level==='act'?'Act 선택 및 관리':'선택 Act의 챕터')}><div className={level==='act'?'concept-group-first-row':'concept-category-bar'}><nav ref={nav} className={level==='act'?'concept-group-navigation':'concept-area-tabs'} aria-label={label}>{items.map(item=>{const button=<button type="button" aria-pressed={level==='act'?selected===item.id:undefined} aria-current={level==='chapter'&&selected===item.id?'true':undefined} onClick={()=>onSelect(item.id)}><strong>{item.title}</strong>{item.meta!==undefined&&<small>{item.meta}</small>}</button>;return level==='act'?<span key={item.id} className="hierarchy-act-tab">{button}</span>:<div className="concept-category-tab" key={item.id}>{button}</div>;})}{!items.length&&<p role="status">{empty}</p>}</nav>{actions&&<div className={level==='act'?'concept-group-actions':'concept-category-list-tools'}>{actions}</div>}</div>{children}</section>;
}
/** Numbered selection rows used by story episodes and NPCs. */
export function HierarchyListRow({index,selected,onSelect,children,onKeyDown}:{index:number;selected:boolean;onSelect:()=>void;children:ReactNode;onKeyDown?:(event:KeyboardEvent<HTMLButtonElement>)=>void}){
 return <div className="concept-field-row" data-selected={selected?'true':'false'}><button className="concept-field-select" type="button" aria-pressed={selected} onClick={onSelect} onKeyDown={onKeyDown}><span className="concept-nav-number">{String(index+1).padStart(2,'0')}</span>{children}</button></div>;
}
