export type ReviewRecord=Record<string,unknown>;
export interface StagedResult {index:number;resultId:string;sha256:string;size:number;mime:'image/png';width:number;height:number;registered:boolean;technicalFailure?:boolean;error?:string;visualReview?:ReviewRecord;generator?:ReviewRecord;imageRequest:{operation:'portrait-review-asset';requestId:string;index:number;sha256:string};}
export interface StagedView {schemaVersion:'npc-portrait-staged-review.v1';requestId:string;registrationIntentId?:string;npcId:string;state:string;error?:string;intent?:string;manifestHash:string;registered:boolean;published:boolean;readOnly:true;results:StagedResult[];batchReview?:ReviewRecord;criteria?:ReviewRecord;}
export function stagedReview(value:unknown,requestId:string):StagedView;
export function stagedAsset(value:unknown,requestId:string,result:StagedResult):Promise<Uint8Array<ArrayBuffer>>;
export const reviewLabels:Record<string,string>;
export function stagedGenerationLabel(value:StagedView):string;
