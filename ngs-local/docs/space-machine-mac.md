# Staged same-Mac Space transport

The local adapter processes are unchanged in purpose. `rs-mcp` keeps its
local queue loop and can optionally run a separate Space queue loop.
`pds-mcp` keeps its local replica loop and can optionally run an independent
Space replica loop. Hosted DNS, credential, gate, response or application
failure never pauses a local loop. Existing process heartbeat names remain.

The only Space endpoint is the verified site's
`https://vinus-npcgen.park-venus0518.chatgpt.site/api/space-machine-mcp`.
The reserved native `/mcp` still belongs to the owner plugin. The machine
transport sends both the platform's service-access bearer and the separate
site-secret header `X-NGS-Machine-Token` without browser or owner identity.
It refuses redirects, alternate destinations, unexpected tool names and
uncorrelated replies. Protocol 2026-07-28 uses a direct stateless JSON-RPC
call. The platform and app authorization are separate checks.

Both adapters default off for Space. Their explicit watch-only settings are:

- `NGS_SPACE_REQUEST_RELAY_ENABLED=1` in the existing rs-mcp service.
- `NGS_SPACE_FILE_SYNC_ENABLED=1` in the existing pds-mcp service.
- `NGS_SPACE_MACHINE_CREDENTIALS_FILE` in each job points to the same existing
  canonical absolute, regular owner-only mode-0600 file in a private folder.
  Its exact JSON fields are `token` and `platformToken`. This package reads
  it only. It does not create credentials, expose their contents, or modify
  permissions. The separately reviewed Request Service uses
  `NGS_SPACE_REQUEST_CREDENTIAL_FILE` pointing at the same file.

The request loop accepts only typed `ngs.space.<UUIDv4>` tickets and sends
only their exact queue ID to the new local RS tool `request_submit_space`.
RS independently reads the same pending Site ticket, preserves true
`source=space` and returns one verified immutable registration receipt.
The consumer verifies its deterministic Space official ID, current status
enum and registration timestamp before sending the full receipt to the
private Site queue. Browser status acknowledges durable registration, not
generation success. Other requests keep progressing, and ambiguity never
clears an undelivered draft.

The file loop reads Binari through the unchanged loopback PDS MCP and uses
the exact existing `ngs_file_sync_*` change/chunk/finish/abort/remove
contracts on the remote. PDS must reconfirm a prior hash and absence before
a recoverable removal. The remote replica is a separate new approved
namespace; neither source nor the local replica is rewritten by a Space
failure. Its write permission does not imply browser read grants.

Before enabling either loop: verify the exact Git commit and builds, deploy
the independently reviewed private Site machine endpoint, prove a fresh
read-only private auth response through the real gateway, verify the new RS
callback for the request loop, and review the initial file plan/scope before
authorizing a full push of project data. Do not toggle audience, provision
another service credential, use a public Mac port, or expect a local fixture
to prove live gateway behavior. Stop an adapter before replacing its
executable/configuration; keep the existing local DB, replica, endpoints,
logs and LaunchAgent labels. Restore original job bytes if startup fails.
