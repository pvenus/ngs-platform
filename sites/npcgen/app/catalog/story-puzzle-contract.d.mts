export type StoryPuzzleAttempt={id:string;nodeId:string;bindingHash:string;bindingKey:string;presetRef:{id:string;version:number;hash:string};inputs:{bell:number;cloth:number;hint:string};phase:'active'|'paused';configurationHash:string;startedAt:string};
export function storyPuzzleSpec(flow:unknown,node:unknown):Record<string,unknown>|null;
export function storyPuzzleInputs(flow:unknown,node:unknown,state:unknown):{bell:number;cloth:number;hint:string};
export function beginStoryPuzzle(session:unknown):Promise<StoryPuzzleAttempt>;
export function validatePuzzleAttempt(attempt:unknown,flow:unknown):Promise<boolean>;
export function applyStoryPuzzleOutcome(run:unknown,event:unknown,engine:unknown):Promise<{applied:boolean;run:unknown}>;
