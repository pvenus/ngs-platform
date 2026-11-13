export function unresolvedRequestCount(views:{commonState?:string;state:string}[]):number;
export function groupRequestHistory<T extends {commonState?:string;state:string}>(views:T[]):{pending:T[];completed:T[];ordered:T[]};
export function requestStatusBadge(view:{commonState?:string;state:string;error?:string|null}):{label:string;tone:string};
export function requestActionBadge(action:string):{label:string;tone:string;description:string};
