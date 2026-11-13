'use client';
import {useEffect,useRef,useState} from 'react';
import {NewRequestModal,useNewRequestStatus} from '../new-request-modal';

/** Reuses the single local management document; never copies its data/editor logic. */
export function EpisodeVisualManager({projectId,actId,chapterId,episodeId,title}:{projectId:string;actId:string;chapterId:string;episodeId:string;title:string}){
 const [local,setLocal]=useState(false),[open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),scroll=useRef<{node:HTMLElement;top:number;left:number}[]>([]);
 function show(){scroll.current=[];for(let node=trigger.current?.parentElement;node;node=node.parentElement)if(node.scrollHeight>node.clientHeight||node.scrollWidth>node.clientWidth)scroll.current.push({node,top:node.scrollTop,left:node.scrollLeft});setOpen(true);}
 function hide(){setOpen(false);requestAnimationFrame(()=>{for(const entry of scroll.current)if(entry.node.isConnected)entry.node.scrollTo({top:entry.top,left:entry.left,behavior:'instant'});trigger.current?.focus({preventScroll:true});});}
 useEffect(()=>setLocal(location.origin==='http://127.0.0.1:5274'),[]);
 if(!local||projectId!=='binari')return null;
 const supported=actId==='story.main.act01'&&chapterId==='chapter01'&&episodeId==='chapter01-01_episode1';
 return <><button ref={trigger} type="button" disabled={!supported} title={supported?'배경·사건 이미지와 인물 연출 관리':'현재 로컬 연출 관리 범위는 에피소드 1입니다.'} onClick={show}>연출 자산 관리</button>{open&&<NewRequestModal kind="story-info" projectId={projectId} target={[actId,chapterId,episodeId,'visual-assets'].join('/')} title={'연출 자산 관리 · '+title} onClose={hide}><VisualFrame/></NewRequestModal>}</>;
}
function VisualFrame(){
 const frame=useRef<HTMLIFrameElement>(null),status=useNewRequestStatus();
 useEffect(()=>{function message(event:MessageEvent){if(event.origin!==location.origin||event.source!==frame.current?.contentWindow)return;const v=event.data;if(v?.type==='npcgen-emotion-state'&&typeof v.dirty==='boolean'&&typeof v.busy==='boolean'){v.dirty?status?.changed():status?.saved();status?.busy(v.busy);}else if(v?.type==='npcgen-emotion-dismiss')status?.dismiss();}window.addEventListener('message',message);return()=>window.removeEventListener('message',message);},[status]);
 return <iframe ref={frame} src="/episode-visuals?embedded=1" title="에피소드 1 연출 자산 관리" style={{display:'block',width:'100%',height:'min(72vh,900px)',minHeight:320,border:0,borderRadius:8,background:'#f4f0e8'}}/>;
}
