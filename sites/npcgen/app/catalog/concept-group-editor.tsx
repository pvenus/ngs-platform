'use client';
import {useState} from 'react';
import {ConceptToolIcon} from '../ui-icons';
import {ConceptGroupOperationDialog} from './concept-group-operation-dialog';
import {catalogTransport,type Snapshot,type CatalogTransport} from './adapter';
import type {ConceptHierarchy} from '../../lib/concept-hierarchy';
type Mode='add'|'update'|'delete';
type Props={hierarchy:ConceptHierarchy;activeGroupId?:string;sections:{id:string;title:string}[];snapshot:Snapshot;transport?:CatalogTransport;refresh?:()=>void;selectionReady?:boolean};
export function ConceptGroupEditor({hierarchy,activeGroupId,sections,snapshot,transport=catalogTransport,refresh,selectionReady=true}:Props){
 const [open,setOpen]=useState<{mode:Mode;groupId?:string;hierarchy:ConceptHierarchy}|null>(null),active=hierarchy.groups.find(group=>group.id===activeGroupId);
 const actions=[{mode:'add' as const,kind:'add' as const,label:'상위 그룹 추가'},{mode:'update' as const,kind:'edit' as const,label:'상위 그룹 수정'},{mode:'delete' as const,kind:'remove' as const,label:'상위 그룹 삭제'}];
 return <><div className="concept-group-actions" role="group" aria-label="최상위 그룹 작업">{actions.filter(action=>action.mode==='add'||selectionReady&&!!active).map(action=><button key={action.mode} type="button" className="concept-group-manage concept-tool-button" data-action-tone={action.mode==='delete'?'danger':undefined} disabled={action.mode!=='add'&&!active} aria-label={action.label+(action.mode!=='add'&&active?': '+active.title:'')} title={action.label+(action.mode!=='add'&&active?' · '+active.title:'')} data-tooltip={action.label} aria-haspopup="dialog" onClick={()=>setOpen({mode:action.mode,groupId:action.mode==='add'?undefined:active!.id,hierarchy:structuredClone(hierarchy)})}><ConceptToolIcon kind={action.kind}/></button>)}</div>{open&&<ConceptGroupOperationDialog hierarchy={open.hierarchy} sections={sections} initialMode={open.mode} targetGroupId={open.groupId} snapshot={snapshot} transport={transport} refresh={refresh} close={()=>setOpen(null)}/>}</>;
}
