import engine from './story-engine';
import type {RecordData,Snapshot} from './adapter';
export type RehearsalMemory={session:ReturnType<typeof engine.createSession>&{pending:any};report:unknown;error:string};
export type RehearsalStore=Map<string,RehearsalMemory>;
/** Page-lifetime, per authorized project + exact target + execution content.
Closing/unmounting a popup never resets it; changed execution content starts anew.
No original object, persistent browser storage or backend is mutated.
*/
export function rehearsalKey(snapshot:Snapshot,target:string,flow:RecordData){return JSON.stringify([snapshot.authorizationScope||'',snapshot.projectId,target,flow]);}
export function rehearsalMemory(store:RehearsalStore,key:string,flow:RecordData){let memory=store.get(key);if(!memory){memory={session:engine.createSession(flow),report:null,error:''};store.set(key,memory);}return memory;}
