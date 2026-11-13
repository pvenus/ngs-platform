'use client';
/** Refresh the shared published snapshot without remounting this tab's controls. */
export function TabRefresh({label,busy,failed,message,refresh}:{label:string;busy:boolean;failed:boolean;message:string;refresh:()=>void}){
 return <div className="button-row tab-refresh" aria-label={`${label} 갱신`}><button type="button" disabled={busy} aria-busy={busy} onClick={refresh}>{label} {busy?'갱신 중…':failed?'다시 갱신':'새로고침'}</button><span className="meta" role="status" aria-live="polite">{busy?'최신 게시 자료를 확인하고 있습니다.':failed?'조회에 실패했습니다. 이전 자료를 유지합니다.':message}</span></div>;
}
