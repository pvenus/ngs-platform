export type Media={id:string;name:string;kind:'portrait'|'pixel'|'animation';npcId:string;npcName?:string;representative:boolean;mime:string;sha256:string;size:number;width?:number;height?:number;assetId:string;reader:'published'|'pixel-normalize';sourceRef?:unknown;requestId?:string;batchId?:string;representativeVersion?:number;metadata:Record<string,unknown>};
export const MEDIA_PAGE_SIZE:15;
export function mediaPage(items:Media[],page?:number):{total:number;pages:number;current:number;items:Media[]};
export function npcMedia(npc:Record<string,unknown>,snapshot:{resources:unknown[]},batches?:Record<string,unknown>[]):Media[];
export function mediaUrlState(search:string,npc:string,items:Media[]):{page:number;selected:string|null;detail:boolean};

export function npcRepresentativeMedia(npc:Record<string,unknown>,snapshot:{resources:unknown[]},batches?:Record<string,unknown>[]):Media[];
