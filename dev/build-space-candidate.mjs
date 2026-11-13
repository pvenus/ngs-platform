/** Compile the NGS hosted shell without provisioning or contacting local services. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spaceCandidateMarker } from '../sites/npcgen/build/space-candidate-boundary.mjs';
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const app = join(root, 'sites/npcgen');
if (process.argv.length !== 2) throw Error('SPACE_CANDIDATE_ARGUMENTS_INVALID');
const parent = join(root, '.dev-runtime');
if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || realpathSync(parent) !== parent)) throw Error('SPACE_OUTPUT_PATH_DENIED');
mkdirSync(parent, { recursive: true, mode: 0o700 });
const output = mkdtempSync(join(parent, 'space-candidate-'));
for (const dir of ['home', 'tmp', 'config', 'logs', 'registry']) mkdirSync(join(output, dir), { mode: 0o700 });
// Explicit UI-only routing tree: legacy API/MCP routes must never enter the hosted bundle.
const frontend = join(output, 'frontend');
for (const entry of ['layout.tsx', 'page.tsx', 'prompt/page.tsx', 'transfers/page.tsx']) {
  const destination = join(frontend, 'app', entry);
  mkdirSync(join(destination, '..'), { recursive: true, mode: 0o700 });
  const source = join(app, 'app', entry);
  if (!existsSync(source) || lstatSync(source).isSymbolicLink() || realpathSync(source) !== source) throw Error('SPACE_UI_SOURCE_INVALID');
  writeFileSync(destination, `export { default } from ${JSON.stringify(source)};\nexport * from ${JSON.stringify(source)};\n`);
}
const marker = { ...spaceCandidateMarker, state: 'building', hostingPackaged: false, publicAssetsCopied: false, standaloneLocalBundleGenerated: false };
const save = () => writeFileSync(join(output, 'SPACE-CANDIDATE.json'), JSON.stringify(marker, null, 2) + '\n');
save();
const env = {
  PATH: process.env.PATH, LANG: 'C', HOME: join(output, 'home'), TMPDIR: join(output, 'tmp'), XDG_CONFIG_HOME: join(output, 'config'),
  NPCGEN_SPACE_OUTPUT: output, PYTHONDONTWRITEBYTECODE: '1', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_LOG_PATH: join(output, 'logs'), WRANGLER_REGISTRY_PATH: join(output, 'registry/wrangler'), MINIFLARE_REGISTRY_PATH: join(output, 'registry/miniflare'),
};
function run(binary, args, cwd) {
  const result = spawnSync(binary, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw Error('SPACE_CANDIDATE_COMPILE_FAILED:' + args[0] + ':' + (result.status ?? 'spawn'));
}
try {
  run('/usr/bin/python3', [join(root, 'dev/check-dependencies.py'), '--mode', 'lock-install'], root);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'], app);
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'space-candidate', '--outDir', join(output, 'site')], app);
  for (const path of ['site/.openai/hosting.json', 'local-application.mjs', 'site/client/ngs-release.json', 'site/client/assembly-runtime', 'site/client/story-runtime', 'site/client/case-assets']) {
    if (existsSync(join(output, path))) throw Error('SPACE_CANDIDATE_UNEXPECTED_ARTIFACT');
  }
  if (!existsSync(join(output, 'site/server/index.js')) || !existsSync(join(output, 'site/client'))) throw Error('SPACE_CANDIDATE_OUTPUT_MISSING');
  marker.state = 'compiled'; save();
  console.log(JSON.stringify({ output, ...marker }));
} catch (error) { marker.state = 'failed'; save(); throw error; }
