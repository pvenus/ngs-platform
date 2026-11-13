import type {StoryCatalog}from './story-catalog-contract.mjs';
type Row=Record<string,unknown>;
export function branchInput(catalog:StoryCatalog,activation:Row,target:Row,requirements:string,extra:Row):Row;
export function catalogPuzzleTargets(flow:Row,target:Row):Row[];
export function formalPresets(value:Row):Row[];
