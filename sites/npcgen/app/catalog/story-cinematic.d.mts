export type CinematicFrame={id:string;type:'black'|'image';text:string;speaker:string;transition:'fade'|'cut';crop?:{x:number;y:number;width:number;height:number}};
export type Cinematic={schemaVersion:'ngs.story-cinematic.v1';frames:CinematicFrame[];continueChoiceId:string};
export function cinematicIssues(value:unknown,node?:Record<string,unknown>):string[];
export function readCinematic(storage:{getItem:(key:string)=>string|null},key:string,value:Cinematic):number;
export function saveCinematic(storage:{setItem:(key:string,value:string)=>void},key:string,value:Cinematic,index:number):void;
