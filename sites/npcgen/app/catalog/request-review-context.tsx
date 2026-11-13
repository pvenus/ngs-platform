'use client';
import {createContext,useContext,type ReactNode} from 'react';
const Context=createContext(false);
export function useUnifiedRequests(){return useContext(Context);}
export function ProjectRequestProvider({children}:{children:ReactNode}){return <Context.Provider value={true}>{children}</Context.Provider>}
export function openProjectRequests(projectId:string){window.dispatchEvent(new CustomEvent('project-request-review-open',{detail:{projectId}}));}
