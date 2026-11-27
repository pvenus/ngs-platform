"""Assemble the two tested proof artifacts in a caller-provided new directory."""
import hashlib,json,shutil,sys
from pathlib import Path

wasm,validator,out=map(Path,sys.argv[1:])
w=out/'browser';v=out/'validator'
out.mkdir(mode=0o700)
w.mkdir(mode=0o700);v.mkdir(mode=0o700)
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
files=[]
bootstrap=(wasm/'wwwroot'/'_framework'/'dotnet.js').read_bytes()
for source in sorted((wasm/'wwwroot'/'_framework').iterdir()):
    if source.suffix not in {'.dll','.json','.js','.wasm'}:continue
    if source.name!='dotnet.js' and source.name.encode() not in bootstrap:continue
    file=w/source.name
    shutil.copyfile(source,file);file.chmod(0o400)
    files.append({'name':file.name,'sha256':digest(file)})
if not any(x['name']=='dotnet.js' for x in files):raise ValueError('missing browser runtime')
(w/'manifest.json').write_text(json.dumps({'schemaVersion':'ngs.puzzle-core-pack.v1','files':files},separators=(',',':'))+'\n')
(w/'manifest.json').chmod(0o400)
for name in ('PuzzleDefinitionValidator.dll','PuzzleDefinitionValidator.runtimeconfig.json','PuzzleDefinitionValidator.deps.json'):
    file=v/name
    shutil.copyfile(validator/name,file);file.chmod(0o400)
    print(name,digest(file))
print('browser manifest',digest(w/'manifest.json'))
