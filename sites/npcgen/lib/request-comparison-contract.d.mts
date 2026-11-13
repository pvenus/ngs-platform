export type RequestAdapter={label:string;result:'three'|'single'|'unsupported';reader:string;layout?:'common-candidate-shell.v1';actions:{confirm:string;discard:string};unsupportedReason:string|null};
export const requestAdapters:Record<string,RequestAdapter>;
export const requestAdapterLabels:Record<string,string>;
export function requestAdapter(type:string):RequestAdapter;
export function assertAdapterCoverage(types:string[]):true;

export const sharedCandidateLayout:'common-candidate-shell.v1';
export const comparisonExtensionContract:Readonly<{schemaVersion:'ngs.comparison-extension.v1';layout:typeof sharedCandidateLayout;component:'ComparisonCandidates';slots:readonly string[];serverOwned:readonly string[];workerLayoutOverride:false}>;
export function assertWorkerComparisonBinding(binding:unknown):true;
