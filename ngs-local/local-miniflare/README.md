# Native Mac replica with Workerd
This opt-in host starts the existing Local browser server and Local request/file
MCP server on 127.0.0.1:5274/5275 with their original authorization. Both share
one Miniflare instance on the mounted external SSD. Invoke
`node sites/npcgen/build/local-miniflare-app.mjs` from the exact release after
`npm ci --ignore-scripts` in this directory. Install uses the checked-in
official-package lock. Set the existing Local settings for the browser and queue,
`NGS_FILE_SYNC_MODE=push`, `NGS_FILE_SYNC_PROJECTS=binari`, and
`NGS_LOCAL_MINIFLARE_ROOT=/Volumes/무제/NGS-Miniflare-...` to a dedicated
canonical, owner-only, existing directory. It refuses another production port or
an unmounted SSD. Do not start a second Miniflare on the same storage directory.

The private worker uses the same `createObjectReplica` and exact D1 migrations
as Space, including the common lazy NPC R2 cache. It has no public route, uses an
ephemeral loopback listener and a random in-process capability, and never accepts
hosted actor headers as local identity. The cache and replica share that instance.
The official RS relay, PDS relay, canonical PDS, and Space are not part of this
app and do not need new credentials, remote access or routes.

Before selection, warm a different SSD namespace and temporary queue/listeners
through the existing PDS read-only MCP and normal raw Local receive path. Verify
the full active S3 and Miniflare path/hash manifests against a fresh PDS
comparison, restart the shadow, and verify Local auth, progress, roster/detail,
cache, and media byte ranges. For production use the existing queue path/inode.
The old S3 object history, prior pointer versions, and tombstones are not implied
to be equivalent by a visible-file match. Preserve them and the original
configuration through rollback. Re-audit after cutover before retiring S3.
An isolated native Workerd fixture is run by setting
`NGS_MINIFLARE_TEST_PACKAGE_JSON` to this package.json and running
`node --test sites/npcgen/tests/local-miniflare-runtime.mjs`.
