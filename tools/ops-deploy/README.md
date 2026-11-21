# Mac NGS executor prototype

This is **not installed or enabled** by source publication. One fixed executable provisioned by an owner runs:
`$HOME/Workspaces/NGS/runtime/deploy-control/bin/ngs-mac-apply <40 lowercase hex SHA>`.
The executable has no shell, network, command/plugin selection, path argument, stage operation, or Space authority. Install from separately reviewed OPS provisioning, not from the candidate being deployed. The only interface to OPS is the one SHA argument and exact success JSON `{"sha":"…","target":"mac","state":"deployed","health":"verified"}`. An exit error must not be treated as deployed. Successful relaunch can only affect `com.vinus.ngs.local-mcp` (combined 5274/5275); it cannot stop PDS, RS, OPS, a relay, or Space.

## Prepare contract

Preparation is separate and must not call this executable. A trusted preparer must verify GitHub's canonical `pvenus/ngs-platform` main push workflow succeeded for this exact commit, attempt, and artifact; validate the downloaded archive against its authenticated provenance, rejecting foreign repo/ref/workflow, forks, expired artifacts, or incorrect hashes. The executor trusts this **owner-private local attestation**; it does not query GitHub, and unsigned user-supplied manifests do not constitute proof. The OPS metadata file is the last atomic write, after every other input is durable.

- All control/manifest/work directories are same-owner canonical non-symlink 0700; the private inputs below are 0600. Stage on disk; no credentials or local environment data in the GitHub artifact.
- `deploy-control/prepared.json`: `{schemaVersion:"ops.ngs-prepared-deploy.v1",sha,verifiedAt,mac:{ready:true},provenance:{runId,runAttempt,artifactId,archiveSha256}}`. Run/attempt/artifact IDs are positive canonical decimal strings; archive digest is lowercase SHA256.
- `deploy-control/mac-releases/<sha>/ngs-local.tar`: exact uncompressed source tar rooted at `ngs-local/` contents, not the GitHub ZIP wrapper. No symlinks or special files. Use the main workflow's `git archive --format=tar <sha>:ngs-local` output. Its authenticated archive proof is the prior item's exact `archiveSha256`.
- `$HOME/Workspaces/NGS/code/releases/project-page-github-<sha>/`: immutable owner-private installed tree. Stage from that exact tar; install locked, approved registry packages beforehand with `npm ci --ignore-scripts` inside `local-miniflare/` (offline from a vetted cache if available). Hash entire installed tree with `tree_sha` from this fixed script. The runner rechecks every archived source file against the installed file and the entire installed tree against the attestation; only dependency-internal links are permitted.
- `$HOME/Workspaces/NGS/runtime/local-miniflare-execution/<sha>/`: private runtime CWD, never the release tree. Runtime Workerd metadata goes here.
- `deploy-control/mac-releases/<sha>/manifest.json`: exact `{schemaVersion:"ops.ngs-mac-release.v1",sha,repo:"pvenus/ngs-platform",ref:"refs/heads/main",workflow:{headSha:sha,headBranch:"main",conclusion:"success",runId,runAttempt,artifactId},archiveSha256,treeSha256,expectedPriorPlistSha256}` from the same externally verified CI proof. Hash the exact current `com.vinus.ngs.local-mcp` plist bytes at prepare time. A changed prior selector requires fresh trusted preparation; there is no force override.

This prototype intentionally refuses changes to native Miniflare startup, current schema migrations, dependency lock, or request-queue storage module. It is not a storage migration runner. Existing SSD R2/D1 persistence and queue inode are pinned before and after, old S3 configuration is refused, current auth/env are preserved, and readiness uses real existing Local endpoints only. The exact-digest check on preparation does not copy or restore user data.

## Outcomes

The single global private lock serializes role changes. The runner first saves `prior.plist` exclusively (sensitive, never exposed), then bootouts the fixed role, atomically replaces the selector, bootstraps, and verifies both sockets belong to the selected exact release; positive authenticated browser/progress and read-only MCP route/queue health must pass. Only private `result.json` on verified deployment includes UTC `deployedAt` (the stdout shape is unchanged). Ordinary failure attempts verified rollback to those exact prior plist bytes. A hard kill/reboot can leave a durable prior with no final `result.json`; do not retry automatically or remove the marker. Report reconciliation needed and independently inspect selector and health. Never present an unverified rollback as success.

Tests: `/opt/homebrew/bin/python3.12 -B tools/ops-deploy/test_mac_apply.py`. The fake host does not run launchctl, write a production path, or call Space/PDS.

## Private assembly bridge

`assemble_mac_release.py` is a library for the private preparation composition,
not a launch script. Use a separately pinned copy paired with
`ngs-services/ops-service/deploy/prepare_ngs_release.py`. The trusted composition
performs the following in that order:

1. Receive the successful canonical main run proof from
   `verified_main_candidate(github)`, and snapshot the exact existing native
   Mac launch plist's SHA256. No arbitrary browser DTO or local Git checkout
   can supply this proof.
2. Call `assemble_verified(verified, control=…, releases=…, scratch=…,
   prior_plist=…, expected_prior_sha256=…, node=…, npm_cache=…)` with the
   approved fixed local control/release/scratch paths, exact installed Node
   24.21.0, and an owner-private canonical offline npm cache. It returns
   `(installed, execution)`. It re-verifies the archive digest, source manifest,
   regular allowlisted members, and prior plist. The native startup, queue
   storage, and SQL/lock files must match the current release byte for byte.
   It runs only offline `npm ci --ignore-scripts`, fixed official npm registry
   URLs and strong lock integrity, clean environment/empty NPM configs; there
   is no build/execute hook or network fallback. A cold cache means **not
   prepared**, not permission to install unreviewed software.
3. Invoke the private verifier's `write_prepared` with the resulting paths
   and the same expected prior SHA256. The verifier must CAS that prior digest
   before publishing the ready record. The assembler itself does not write
   readiness, execute the candidate, contact deployment APIs, or alter the
   selected plist. An existing source or scratch directory fails closed;
   inspect incomplete unselected packages through trusted operator tooling
   rather than automatically overwriting them.

Isolated assembly tests:
`/opt/homebrew/bin/python3.12 -B tools/ops-deploy/test_assemble_mac_release.py`.
A real offline Node/npm assembly can use a dedicated owner-only test cache
warmed from previously vetted official npm cache data; it never needs to share
production queue or Workerd data.
