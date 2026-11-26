# Shared prop workspace

The Local and Space shell serve the same browser module and use the shared
workspace replica registry. `프랍 설계` lists published folders and small latest
pointers (`props/<propId>/metadata.json`) without opening packages or images.
A selection verifies the actual immutable manifest SHA and resolves only its
typed assets. The inline Detail and Pixel previews loop until stopped or the page changes.
Only the browser preview copy loops; published files and puzzle playback remain
one-shot. Preview URLs are same-origin; individual APNGs are only fetched
on play. No Local draft, fixture overlay, generic file query or NPC video route.

Writes use the existing authenticated `/api/requests` queue. On native
Mac NGS, the private server checks the actual Request Service MCP
`request_submit` schema (read-only `tools/list`) before showing the Add or
Regenerate controls, and rechecks before enqueueing. It accepts only the
confirmed static `still` mode for creation/regeneration. A separate
`prop.animation.generate` schema with the selected source revision and SHA
enables only the existing-prop animation action, never a create/regenerate
mode. An inaccessible or mismatched schema produces no active control. The normal RS-MCP relay must be at this same release before
activating the native app. It forwards the typed request; there is no direct
browser call to the Request Service.

The common Space UI also requires explicit server capabilities. Its
`NGS_PROP_GENERATE_ENABLED`, `NGS_PROP_REGENERATE_ENABLED` and
`NGS_PROP_ANIMATION_ENABLED` settings are off by default; this Mac deployment
does not set them or publish Space. Space applies its existing active Binari
participant roster to the `props` resource, not the queue-only exception.
The design pin additionally requires the existing `concept` grant.

To adopt the existing private Mac preview release, the reviewed ordinary OPS
assembler and native executor recognize an owner-pinned
`project-page-local-candle-<40 hex>` only as a predecessor, with the matching
commit binding and execution directory. Destination is always the verified
GitHub artifact. Queue, Miniflare data, startup/schema pins and preview files
are unchanged. The usual private predecessor plist/rollback is retained.

`prop.generate` is a complete creation intent, not an image request.
The Add popup may choose one reference from the published prop list
(default: none). The submission pins that folder's revision and manifest
SHA, uses its detail image in the generation worker, and creates a
different, new folder. A reference that has changed or disappeared must be
selected again. Only CREATE accepts a reference; geometry consistency is
guided by the image, not guaranteed by exact compositing.
A regeneration targets one current published folder by revision and SHA.
It replaces the active pointer only after a full new package is published;
prior versions and assets remain preserved. Existing animations are not copied
into the new version by default.
A named animation request targets one current folder and accepts one prompt,
with no preset pickers and no new base image. Accepted responses only prove
queueing; assets remain listed only after canonical publication and normal
replica sync. This change does not install runtime providers or author test
assets in the real project.
