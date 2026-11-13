"use client";
import {useId,useState,type MouseEvent,type ReactNode} from 'react';
import {type Json} from './adapter';
import {FullValue} from './fields';
import {readConceptSummary} from './concept-summary';
/** Summary is always complete. Expansion adds the authoritative body underneath. */
export function ConceptBodyPreview({value,summary,label,alwaysExpanded=false,summaryActions}:{value:Json|undefined;summary?:Json;label:string;alwaysExpanded?:boolean;summaryActions?:ReactNode}){
 const id=useId(),preview=readConceptSummary(summary),[expanded,setExpanded]=useState(false);
 function bodyClick(event:MouseEvent<HTMLDivElement>){
  if(alwaysExpanded||!preview||event.detail>1||(event.target as Element).closest('a,button,input,textarea,select,summary,[role="button"],[contenteditable="true"]'))return;
  const selection=window.getSelection();if(selection&&!selection.isCollapsed&&selection.containsNode(event.currentTarget,true))return;
  setExpanded(previous=>!previous);
 }
 return <div className="concept-preview" data-preview-source={preview?'summary':'body-fallback'} data-expanded={alwaysExpanded||expanded?'true':'false'}>
  <div className="concept-preview-content" onClick={bodyClick}>
   {preview?<div className="concept-summary">
    {preview.kind==='keywords'&&<div className="concept-summary-keyword-group"><p className="concept-summary-label">핵심 키워드</p><ul className="concept-summary-keywords" aria-label={`${label} 핵심 키워드`}>{preview.keywords.map(keyword=><li key={keyword}>{keyword}</li>)}</ul></div>}
    <div className="concept-summary-sentence-group"><div className="concept-summary-heading"><p className="concept-summary-label">요약</p>{summaryActions}</div><p className="concept-summary-sentence">{preview.sentence}</p></div>
   </div>:<>{summaryActions&&<div className="concept-summary-heading"><span className="concept-summary-label">요약</span>{summaryActions}</div>}<FullValue value={value}/></>}
  </div>
  {preview&&<><div id={id} className="concept-preview-full-body" hidden={!alwaysExpanded&&!expanded}>{(alwaysExpanded||expanded)&&<FullValue value={value}/>}</div>{!alwaysExpanded&&<button type="button" className="concept-preview-toggle" aria-expanded={expanded} aria-controls={id} aria-label={`${label} ${expanded?'전문 접기':'전체 보기'}`} onClick={()=>setExpanded(previous=>!previous)}>{expanded?'전문 접기':'전체 보기'} <span aria-hidden="true">{expanded?'⌃':'⌄'}</span></button>}</>}
 </div>;
}
