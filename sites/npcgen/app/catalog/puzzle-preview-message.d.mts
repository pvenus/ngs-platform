export type PreviewInput={bell:number;cloth:number;bellTarget:number;clothTarget:number;tolerance:number;coupling:number};
export type PreviewState={bellNear:number;clothNear:number;bellMatched:boolean;clothMatched:boolean;firstResidual:number;secondResidual:number;combined:number};
export function previewInput(value:unknown):value is PreviewInput;
export function previewState(value:unknown,requestId:string):PreviewState|null;
