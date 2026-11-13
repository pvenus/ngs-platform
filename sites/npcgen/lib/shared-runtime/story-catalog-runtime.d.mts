export type CatalogRuntimePin={catalogId:string;catalogVersion:number;catalogHash:string};
export function catalogRuntimePin(snapshot:{storyCatalogRef?:unknown}):CatalogRuntimePin|null;
export function assertCatalogRuntimePin(value:Record<string,unknown>,pin:CatalogRuntimePin|null):Record<string,unknown>;
export function verifyCatalogRun(run:{sourcePin?:Record<string,unknown>},pin:CatalogRuntimePin|null,revision:number,flowHash:string):void;
