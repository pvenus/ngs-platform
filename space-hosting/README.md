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
