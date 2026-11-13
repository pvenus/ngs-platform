export type ProvenanceInfo={kind:string;label:string;description:string;recordedKind:string;modelGenerated:boolean;testOnly:boolean;requestId:string;jobId:string};
export function provenanceInfo(value?:Record<string,unknown>):ProvenanceInfo;
export function lifecycleInfo(value?:Record<string,unknown>):{state:string;label:string;selected:boolean;completed:boolean;registered:boolean;publicationVerified:boolean;description:string};
