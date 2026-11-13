export type StoryCatalog={id:string;version:number;kind:'current'|'legacy'|'source';sourceRef:{revision:number;documentHash:string};membership:{target:{actId:string;chapterId:string;episodeId:string};episodeHash:string;flowHash:string|null}[];display:{actLabel?:string;chapterLabel?:string};progression?:{status:string;nextEpisodeId:string|null};document:Record<string,unknown>;documentHash:string;readOnly:boolean;[key:string]:unknown};
export const catalogKinds:Record<string,string>;
export function storyTarget(query:string):{actId:string;chapterId:string;episodeId:string};
export function storyCatalogUrl(href:string,catalog:StoryCatalog,target:{actId:string;chapterId:string;episodeId:string},options?:{switching?:boolean}):URL;
export function storyDigest(value:unknown):Promise<string>;
export function catalogEpisodes(document:Record<string,unknown>):{target:{actId:string;chapterId:string;episodeId:string};episode:Record<string,unknown>}[];
export function verifyStoryCatalog(value:unknown):Promise<StoryCatalog>;

export type CatalogReadOperation='story-catalog-index'|'story-catalog-plan'|'story-catalog-get'|'story-catalog-resolve';
export function storyCatalogRequest(operation:CatalogReadOperation,payload?:Record<string,unknown>):Record<string,unknown>;
