'use client';
import {NgsVersion} from '../ngs-version';
import {ProjectIcon,ProjectIconSettings} from './project-icon';
import {StatusConsoleSection} from '../status-console';
import {useFrontendAccountName,useFrontendAuthKey} from '../frontend-session';
import {frontendFetch} from '@/lib/frontend-transport.mjs';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import {selectableProject} from '@/lib/project-bindings';
import {purgeCatalogCaches} from './adapter';
const Workspace=dynamic(()=>import('./workspace'));
type Project={id:string;label:string};
export default function CatalogHome({displayName:initialDisplayName}:{displayName:string}){
 const displayName=useFrontendAccountName(initialDisplayName),authKey=useFrontendAuthKey();
 const [projects,setProjects]=useState<Project[]>([]),[selected,setSelected]=useState(''),[opened,setOpened]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setProjects([]);frontendFetch('/api/catalog-projects',{signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok){if([401,403].includes(response.status))purgeCatalogCaches(undefined,true);throw new Error('프로젝트 목록을 확인하지 못했습니다.');}return await response.json() as {projects:Project[]};}).then(data=>{if(controller.signal.aborted)return;const list=data.projects.filter(p=>selectableProject(p.id)).map(p=>({...p,label:p.id==='binari'?'프로젝트':p.label}));setProjects(list);const id=new URLSearchParams(location.search).get('projectId')||'';setSelected(previous=>list.some(p=>p.id===id)?id:list.some(p=>p.id===previous)?previous:'');setOpened(list.some(p=>p.id===id)?id:'');}).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[retry,authKey]);
 useEffect(()=>{setOpened('');setSelected('');},[authKey]);
 useEffect(()=>{function restore(){const id=new URLSearchParams(location.search).get('projectId')||'';setOpened(projects.some(p=>p.id===id)?id:'');setSelected(projects.some(p=>p.id===id)?id:'');}window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[projects]);
 function home(){setOpened('');setRetry(value=>value+1);const url=new URL(location.href);for(const key of ['projectId','catalogArea','npcTab','chapter','npcCategory','npcCategoryNpc','npcView','npcViewNpc','npcViewRule'])url.searchParams.delete(key);url.hash='';history.pushState(history.state,'',url);}
 if(opened)return <Workspace key={opened} displayName={displayName} initialProjectId={opened} onHome={home}/>;
 function open(projectId:string){if(loading||!projects.some(p=>p.id===projectId))return;setOpened(projectId);const url=new URL(location.href);url.searchParams.set('projectId',projectId);for(const key of ['catalogArea','npcTab'])url.searchParams.delete(key);url.hash='';history.pushState(history.state,'',url);}
 return <div className="workspace catalog-workspace project-home"><header className="site-header"><div className="brand"><span className="brand-mark" aria-hidden="true">N</span><div><h1>NPC Gen</h1><span className="overline">BY VINUS</span><NgsVersion/></div></div><div id="status-menu-slot" className="status-menu-slot" aria-label="상태 메뉴"/></header><main className="project-home-main"><div className="home-intro"><span className="overline">YOUR PROJECTS</span><h2>어떤 이야기를 만들까요?</h2><p>프로젝트를 열고 이야기와 인물을 이어가세요.</p></div><div className="project-card-grid">{projects.map(project=><div className="project-card-entry" key={project.id}><button type="button" key={project.id} className="project-icon-card" onClick={()=>open(project.id)} aria-label={`${project.label} 프로젝트 열기`}><span className="project-icon-art"><ProjectIcon projectId={project.id} label={project.label}/></span><strong>{project.label}</strong><span className="project-card-description">세계관 · 이야기 · 인물</span><span className="project-card-arrow" aria-hidden="true">↗</span></button><ProjectIconSettings projectId={project.id} label={project.label}/></div>)}</div>{loading&&<p role="status">프로젝트를 불러오고 있습니다.</p>}{error&&<p role="alert" className="error">프로젝트를 불러오지 못했습니다. <button type="button" onClick={()=>setRetry(v=>v+1)}>다시 조회</button></p>}{!loading&&!error&&!projects.length&&<p>조회 가능한 프로젝트가 없습니다.</p>}</main><StatusConsoleSection id="home" title="프로젝트 조회" level={error?'error':'info'}><p>{loading?'프로젝트 조회 중':error||`조회 가능한 프로젝트 ${projects.length}개`}</p></StatusConsoleSection></div>;
}
