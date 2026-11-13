# Third party notices retained in this candidate

The following source notices are included unchanged alongside their code:

- `sites/npcgen/build/sites-vite-plugin.ts`:
  `sites/npcgen/build/sites-vite-plugin.LICENSE`, MIT, Copyright 2026 OpenAI.
- `sites/npcgen/vendor/shadcn-tailwind-4.13.0.css`:
  `sites/npcgen/vendor/shadcn-tailwind-4.13.0.LICENSE.md`, MIT, Copyright 2023 shadcn.

Do not remove those notices from redistributed copies or substantial portions.
The four named code/notice files match the source revision byte for byte.

## Six shadcn/ui components

`sites/npcgen/components/ui/{badge,button,input,select,skeleton,textarea}.tsx`
correspond to the official shadcn/ui `new-york-v4` registry sources at commit
`dd41d19e2f80ff6891951f7ced74c2c9a650b065`. Each component's code matches that pinned official source
apart from the `cn` utility import alias (`cn` to `@/lib/utils`), placement of
that import, and blank lines. The standalone export further relocates the local
`cn` utility import with its existing public-resource separation; component logic
is unchanged. The live official registry JSON also matched the
pinned source byte-for-byte at review time. This establishes source correspondence,
not the original installation date or original generator version.

Official pinned sources:
https://github.com/shadcn-ui/ui/tree/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/registry/new-york-v4/ui

License: MIT, Copyright (c) 2023 shadcn. The complete official license is retained
at `sites/npcgen/vendor/shadcn-tailwind-4.13.0.LICENSE.md`; its bytes are identical to:
https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/LICENSE.md

Retain the copyright and permission notice with copies or substantial portions.
The existing local import adaptation does not require replacement of the components.

This scoped comparison is not a complete origin or license certification for all
other code or content. Dependencies are installed separately from the npm lockfile
and retain their own licenses and notice requirements. No dependency binaries or
node_modules are included in this source archive.
