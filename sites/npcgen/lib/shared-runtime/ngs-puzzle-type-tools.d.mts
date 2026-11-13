type Row=Record<string,unknown>;type Rpc=(v:Row)=>Promise<Row>;
export function openPuzzleTypes(rpc:Rpc):Promise<void>;
export function validateTypeInput(definition:Row,origin:string,sourceRefs?:Row[]):Row;
