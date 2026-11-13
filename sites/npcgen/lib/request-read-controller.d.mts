export function createReadPoller(options:{read:(signal:AbortSignal)=>Promise<any>;onValue:(value:any)=>void;onError:(error:any)=>void;onState?:(active:boolean)=>void;canRun?:()=>boolean;interval?:number;timeout?:number;setTimer?:any;clearTimer?:any}):{refresh:()=>Promise<any>;dispose:()=>void;readonly active:boolean};
export function mergeReadResults(previous:any[],response:any):any[];
