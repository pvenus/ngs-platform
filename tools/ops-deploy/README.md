# Mac NGS executor prototype

This is **not installed or enabled** by source publication. One fixed executable provisioned by an owner runs:
`$HOME/Workspaces/OPS/runtime/deploy-control/bin/ngs-mac-apply <40 lowercase hex SHA>`.
The executable has no shell, network, command/plugin selection, path argument, stage operation, or Space authority. Install from separately reviewed OPS provisioning, not from the candidate being deployed. The ordinary OPS invocation takes one SHA argument and returns exact success JSON `{"sha":"…","target":"mac","state":"deployed","health":"verified"}`. An exit error must not be treated as deployed. Successful relaunch can only affect `com.vinus.ngs.local-mcp` (combined 5274/5275); it cannot stop PDS, RS, OPS, a relay, or Space.

## Control location

The fixed control root is `$HOME/Workspaces/OPS/runtime/deploy-control`.
It contains preparation receipts, exact deployment archives, fixed executors,
and apply history. There is no fallback to the former root under NGS. During
an operator-managed cutover, stop the old control consumers and move that
single existing private tree, then re-pin the new fixed binary and wrapper
paths before enabling the cycle. Do not leave a second active tree or add a
symlink. The NGS release tree, Miniflare execution CWD, queue, and storage
remain at their existing NGS locations.

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

The single global private lock serializes role changes. The runner first saves `prior.plist` exclusively (sensitive, never exposed), then bootouts the fixed role, waits up to 10 seconds for its two listeners to close, and atomically replaces the selector, bootstraps, and verifies both sockets belong to the selected exact release; positive authenticated browser/progress and read-only MCP route/queue health must pass. Only private `result.json` on verified deployment includes UTC `deployedAt` (the stdout shape is unchanged). Ordinary failure attempts verified rollback to those exact prior plist bytes. If the listener wait fails before the selector changes, rollback gives the same previously verified PID up to 10 more seconds to release both ports. It never attempts bootstrap while either port is still occupied; a foreign listener aborts immediately. The original failure remains recorded, with a separate typed rollback failure if the ports do not drain. A hard kill/reboot can leave a durable prior with no final `result.json`; do not retry automatically or remove the marker. Report reconciliation needed and independently inspect selector and health. Never present an unverified rollback as success.


The runner emits a single diagnostic JSON line on stderr:
`{"schemaVersion":"ops.ngs-mac-apply-error.v1","failure":{"stage":"…","code":"…"}}`.
Verified rollback records `{"state":"rolled-back","failure":{…}}` in the
private receipt; unverified rollback records `"rollback-failed"` plus
`rollbackFailure`. Stderr, launch output and selector contents are never copied
into these diagnostic fields.

### Explicit same-SHA retry

Only an explicit OPS retry may append `<attemptId> <expectedPreviousAttemptId>`
to the ordinary argument. Retry IDs are distinct nonzero, lowercase 32-digit
hex strings, and the previous ID is `initial` or an exact prior retry ID.
The original `prior.plist` and `result.json` stay unchanged. Each retry has
its own files in `mac-releases/<sha>/attempts/<attemptId>/`; the private
`attempts/current.json` ledger has `{"attemptIds":[…]}` in reservation order.

Under the same global lock, the runner checks the immutable candidate and
archive again, rejects stale or reused IDs, requires a verified rollback
receipt for the latest attempt (accepting the original legacy rolled-back
receipt), and proves the archived prior selector, prepared pin, current
selector, process health and storage checks agree before reserving a retry.
An incomplete attempt, malformed or torn ledger, changed prior identity, or
unverified rollback blocks all retries until separately reconciled. No
automatic retry or marker removal is performed.

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
   approved fixed control/release/scratch paths (the defaults are the OPS
   control root and existing NGS release/scratch roots), exact installed Node
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

A foreign listener never gets the shutdown grace period. The runner reports the existing port-busy diagnostic and does not stop unrelated processes.

### Indexed-audio Local upgrade

The native apply runner recognizes one exact 0016 startup-input transition.
The GitHub-verified candidate archive is still required, and other changed
startup schemas remain unsupported. Before selector CAS, it confirms exact
predecessor D1 schema and a stopped service (recognized launchd absence,
both Local ports closed, prior PID gone, no holder of the exact D1 SQLite
file or journal). The storage file must keep the same device/inode.

If the candidate fails after selection, the runner stops it and establishes
the same hold before restoring the old selector. The SQLite transaction
permits only the exact predecessor or 0016 schema. For 0016 it removes the
two derived audio-index tables and restores the pinned predecessor schema
digest, then verifies the exact predecessor shape before any restart. No
replica version rows, R2 objects, queue, or source files are restored or
removed. Uncertain hold, storage identity, or schema leaves the service
stopped and reports rollback unverified; operator intervention is required.
A rollback of a successfully deployed new binary is not a new CLI mode.
