'use client';
import {useEffect,useRef,useState} from 'react';
import {assemblyPlayEntry} from '../../lib/assembly-play-selection.mjs';
import {ConceptToolIcon} from '../ui-icons';
import {NewRequestModal} from '../new-request-modal';
/** NGS launch shell only. Each explicit launch creates a fresh immutable player; old persistent saves are untouched. */
export function AssemblyPlayModal({url,title,version,projectId,label,compact=false}:{url:string;title:string;version:number;projectId:string;label?:string;compact?:boolean}){
 const [open,setOpen]=useState(false);
 const frame=useRef<HTMLIFrameElement>(null);
 useEffect(()=>{let active=true;queueMicrotask(()=>{if(active&&assemblyPlayEntry(location.search,url,projectId)){setOpen(true);}});return()=>{active=false;};},[url,projectId]);
 useEffect(()=>{if(open)frame.current?.focus();},[open]);
 const valid=/^\/assembly-runtime\/formal\.[a-f0-9]+\/index\.html\?/.test(url);
 return <><button type="button" className={compact?'concept-tool-button story-play-button':undefined} aria-label={compact?'플레이: '+title:undefined} data-tooltip={compact?'처음부터 플레이':undefined} aria-haspopup="dialog" title={'처음부터 플레이 · '+title+' · 조립 v'+version} style={compact?undefined:{minHeight:44,minWidth:104,fontWeight:700}} disabled={!valid} onClick={()=>{setOpen(true);}}>{compact?<ConceptToolIcon kind="play"/>:label||('플레이 · 조립 v'+version)}</button>{open&&<NewRequestModal immersive kind="story-play" title={title+' · 조립 v'+version} target={'assembly:'+url} projectId={projectId} open={open} onClose={()=>setOpen(false)}><p className="assembly-play-help">플레이를 누를 때마다 에피소드 처음부터 시작합니다. 중간 진행을 저장하거나 불러오지 않습니다.</p><iframe className="assembly-play-frame" ref={frame} tabIndex={0} onLoad={e=>{if(open)e.currentTarget.focus();}} title={title+' · 조립 v'+version+' 플레이'} src={url} style={{display:'block',width:'100%',height:'100%',minHeight:0,border:0,borderRadius:0,background:'#10191d'}} /></NewRequestModal>}</>;
}
