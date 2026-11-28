import {verifyNtfsRoot} from '../lib/windows-storage.mjs';
if(process.platform!=='win32'||process.argv.length!==3)process.exit(1);
try{verifyNtfsRoot(process.argv[2],{});}catch{process.exitCode=1;}
