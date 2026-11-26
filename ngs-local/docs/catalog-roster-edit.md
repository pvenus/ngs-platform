# Catalog roster edit mode

The background, cinematic, prop and NPC rosters share one edit icon, separate row
checkboxes, and a confirmation dialog. Checkboxes are hidden until edit mode.
Selecting a checkbox does not navigate, and submitting a deletion does not
remove a row optimistically. Once the canonical deletion is published and
replicated, a normal list refresh removes its entry. A partial intake failure
keeps only the failed entries selected for explicit retry.

The controller accepts a `deleteItem({id,title})` function from its authorized
workspace. It does not accept paths from the user or infer what to delete. Only
mount the controls when the folder deletion route for this type is truly ready.
The read path, search state and normal selection are unchanged in read-only
sessions. The background search uses the same label, input classes, layout,
tokenization and scroll-anchor persistence as cinematic search.

## Physical scope

The user selects an entire catalog item, not its currently shown tab or a
version thumbnail. Every common `file.delete` request authorizes one physical
file **or** directory. Specify only published resources backed by the exact
current catalog identity. Do not delete shared preset/reference files or select
a parent directory that includes other rows.

- Props: one prop-owned folder including every revision and animation.
- NPCs: one NPC-owned folder, plus roster bookkeeping through the existing
  generation-fenced workflow delete authority. Never bypass the authority with
  an arbitrary folder move.
- Backgrounds: the current catalog uses independent PNG and metadata files, not
  item directories. Bind the exact pair by the source hash and existing receipt
  before using separate common requests, or migrate to individual owned
  directories before enabling. Do not pass the shared backgrounds directory.
- Cinematic scenes: the source PNG and its metadata pair, all (even archived)
  linked PNG sequence folders, and any related legacy MP4/metadata files must be
  bound to the same scene before removal. Do not infer membership from a
  filtered UI list. A write in flight for that scene must not re-publish it
  during deletion. Do not replace the feature with a hidden-items list.

The browser component can be tested with a mocked exact intake, but that does
not prove canonical deletion, stale target rejection, or Local/Space sync.
Never enable a category based on the browser test alone.
