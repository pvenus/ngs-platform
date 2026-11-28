# NGS Space hosting adapter

The browser source is the same `ngs-local/` used by the Mac. The overlay packages that directory verbatim into an existing Sites host scaffold; the scaffold owns deployment identity and native sign-in, not NGS source. The host supplies its existing brand mark independently. No project data, credentials, databases or runtime settings are included here.

Until a real approved PDS/RS MCP transport is configured and verified, the browser receives an explicit unavailable response for business endpoints instead of a cached legacy dataset or a simulated request receipt.

For a release with independently verified canonical GitHub provenance, invoke
`space-hosting/apply.sh <staged-site-scaffold> <full-ngs-platform-source-sha>`.
The stamp is compiled into that selected artifact from the exact committed
source, never read from the Sites repository SHA or a mutable Site environment
variable. Omit the second argument when canonical provenance is unknown; the
authenticated `space_requests_pending` result then carries no
`X-NGS-Commit-Sha` header. Browser endpoints, file sync, and failed or unrelated
machine calls never report it.


The same authenticated machine MCP also offers
`space_ngs_deployment_status({})`. It returns
`{commitSha: string | null, deployedAt: string | null}`. The commit identifies
the canonical NGS artifact serving this request, which may differ from the
latest saved Site version. The current implementation always returns
`deployedAt: null`: no trusted Sites publication timestamp is available inside
the Worker. Consumers needing actual publication time must read the native
Sites deployment status for the matching production version. Do not infer
it from a Git commit, build date, queue poll, or request time.

## Formal Binari request authorization

The hosted browser queue and Viewer MCP require Sites authentication and an
active Binari team membership. Workspace actions are identical for owner,
editor and viewer team members. Non-members and revoked members remain denied.
Product capabilities ship with the NGS release; no per-host feature flag or
additional email grant is used. Site administration is outside workspace actions.
