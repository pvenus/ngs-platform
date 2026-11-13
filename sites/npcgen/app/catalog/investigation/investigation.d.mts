export function validate(value:unknown):Record<string,unknown>;
export function validateBinding(value:unknown,nodeIds:unknown[],stateKeys:string[]):Record<string,unknown>;
export function createRun(definition:unknown,binding:unknown,state:unknown,nodeIds:unknown[],stateKeys:string[]):Record<string,unknown>;
export function mount(root:HTMLElement,initial:unknown,options:{image?:(ref:Record<string,unknown>)=>string|null;onOutcome?:(event:Record<string,unknown>)=>void}):{getState:()=>Record<string,unknown>;destroy:()=>void};

export function restoreRun(initial:unknown,saved:unknown):Record<string,unknown>;
