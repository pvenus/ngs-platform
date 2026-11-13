'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {row,type PuzzleRow} from './puzzle-design-api';
export function PuzzleJsonDialog({title,value,onClose,onApply}:{title:string;value:unknown;onClose:()=>void;onApply?:(value:PuzzleRow)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),heading=useId(),[text,setText]=useState(()=>JSON.stringify(value,null,2)),[editing,setEditing]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,node=dialog.current;node?.showModal();return()=>{node?.close();previous?.focus();};},[]);
 function apply(){try{const next=JSON.parse(text);if(!next||typeof next!=='object'||Array.isArray(next))throw Error('JSON 객체를 입력하세요.');onApply?.(row(next));onClose();}catch(e){setError('JSON 형식이나 입력값을 확인하세요. '+(e instanceof Error?e.message:String(e)));}}
 return <dialog ref={dialog} className="puzzle-json-dialog" aria-labelledby={heading} onCancel={onClose} onClose={onClose}><header><div><span className="overline">상세 정보</span><h2 id={heading}>{title}</h2></div><button type="button" aria-label="상세 JSON 닫기" onClick={onClose}>닫기 ×</button></header><p>현재 화면의 동일한 정의를 문자열 JSON으로 확인합니다. 고급 편집을 적용해도 저장 전에는 검토 초안입니다.</p><textarea aria-label="상세 JSON 문자열" value={text} readOnly={!editing} onChange={e=>setText(e.target.value)} spellCheck={false}/>{error&&<p className="error" role="alert">{error}</p>}<footer>{onApply&&!editing&&<button onClick={()=>setEditing(true)}>고급 JSON 편집</button>}{onApply&&editing&&<button onClick={apply}>편집 내용 적용</button>}<button onClick={onClose}>닫기</button></footer></dialog>;
}
