# Cinematic video workspace

The Binari Cinematic Video tab shows project-owned PNG sources, accepts one
motion prompt and lists playable/downloadable MP4 results, after normal file
replication. Inputs are immutable and addressable by SHA-256 in
`cinematics/sources/<sha256>.png`; this feature does not take arbitrary network
URLs or filesystem paths. Import source images with the authorized Filex owner
path before requesting generation. The UI does not write directly to Filex.
Result metadata and video under `cinematics/results/` are checked for matching
length and digest before playback. The branch never uses prop postprocessing,
foreground segmentation, transparency, or pixel conversion.

Local only advertises request submission when its own trusted PDS returns the
cinematic capability. Space uses the same browser payload, read route and
replica contract. Hosted admission is off by default and can only be enabled
by the operator using `NGS_CINEMATIC_ENABLED=1` after the worker, PDS/Filex scope
and canonical RS are verified. This does not grant additional project access.
Acceptance into the browser queue does not mean a clip has been generated.
