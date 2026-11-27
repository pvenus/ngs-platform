# Local NGS puzzle playground

This is a single independent Binari puzzle under `퍼즐 설계`: **빈 마루에
바람이 앉으면**. It has no Episode 1/story binding, authoring mutation, or
legacy `/api/production-sets` dependency. It uses the current Local NGS listener
and browser project/session grant. It is not routed on Space.

The normal **native Mac Local NGS launcher** defaults to the owner-private
`~/Workspaces/NGS/runtime/puzzle-design-assets/binari-bad-ending-v1` bundle,
so an approved deployment via the existing immutable OPS runner does not
require editing the launch plist. The standalone Local server and hosted
runtimes do not use this default. An explicit Local
`NGS_LOCAL_PUZZLE_MEDIA_ROOT` overrides it; an explicit empty value disables
it. The directory must contain the private exported media directly and be owned by the
service user with mode 0700. Require same-owner, regular, single-link files
with mode 0600; no symlinks. Required names:

- `home.webp`, `shoulders.webp`, `yard.webp`, `shoes.webp`, `room.webp`,
  `ribbon.webp`, `doll.webp`, `candle.webp`
- `ignition.mp4`, `doll-dissolve.mp4`, `ribbon-dissolve.mp4`, `bowed.mp4`,
  `ending.mp4`
- `intro-loop.wav`

Stage and verify these private bytes separately from the source release. Do not
put them in Git, a public asset root, a project replica, or the Space bundle.
Leave the configured set stable while the service is running. An absent or
invalid bundle leaves the ordinary tab disabled and does not disrupt other NGS
workspaces.

When enabled, open the existing NGS project at
`/?projectId=binari&catalogArea=production&item=binari.empty-veranda`.
The embedded view and bounded GET/HEAD media routes share the existing
loopback origin. The exact v28 pointer collector is byte reused; scene hit
behavior is a JS port of the historical C# kernel. The historical runtime and
v19 API are not deployed.

### 영물 현현

Compose the single `spirit` prop slot with a reachable map anchor and a published
prop that has both reduced image variants. The puzzle starts `veiled` and is
visible only with Seojin's ability ON. Interacting nearby with F at that moment
sets `manifested` once; both OFF and ON subsequently show their own art. The
normal ability button is present in both isolated and assembled puzzle play.
Turning it OFF never resets the puzzle. A new play session resets it. Presses
outside the actor's interaction range or while veiled in OFF do nothing. The
published assembly uses the ordinary `file.update` request and can place this
puzzle alongside a well puzzle without changing the map or prop definitions.
