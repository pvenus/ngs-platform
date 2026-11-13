export function storyHistoryQuery(query:string):boolean;
export function storyNavigation(index:Record<string,unknown>,selected?:Record<string,unknown>):{active:Record<string,unknown>|null;groups:{kind:string;items:Record<string,unknown>[]}[];categories:{id:unknown;kind:unknown;versions:Record<string,unknown>[]}[]};
export function preferredStoryTarget(catalog:{membership:{target:{actId:string;chapterId:string;episodeId:string}}[]},target:{actId:string;chapterId:string;episodeId:string}):{actId:string;chapterId:string;episodeId:string}|undefined;

export function storyCatalogQuery(query:string):string;

export function storyVersionStatus(index:Record<string,unknown>,selected?:Record<string,unknown>):{latestVersion:number;outdated:boolean};
