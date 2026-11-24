# Shared prop workspace

The Local and Space shell serve the same browser module and use the shared
workspace replica registry. `프랍 설계` lists published folders and small latest
pointers (`props/<propId>/metadata.json`) without opening packages or images.
A selection verifies the actual immutable manifest SHA and resolves only its
typed assets. Preview URLs are same-origin; individual APNGs are only fetched
on play. No Local draft, fixture overlay, generic file query or NPC video route.

Writes use the existing authenticated /api/requests queue. The three distinct
opt-in capabilities `NGS_PROP_GENERATE_ENABLED`, `NGS_PROP_UPDATE_ENABLED` and
`NGS_PROP_ANIMATION_ENABLED` default off in both runtimes. Configure one only
after the same normal Request/Planner/worker/PDS/Filex path is verified for
that operation. Capability checks are enforced on the server as well as the
browser. Space checks its existing active Binari participant roster for the new
`props` resource, not the optional queue-only exception. The design pin
additionally requires the existing `concept` grant.

`prop.generate` is a complete creation intent, not an image request. An edit
targets one current published folder and includes its exact revision and SHA;
a named animation request targets one current folder and accepts one prompt,
with no preset pickers and no new base image. Accepted responses only prove
queueing; assets remain listed only after canonical publication and normal
replica sync. This change does not install runtime providers or author test
assets in the real project.
