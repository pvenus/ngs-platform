# NGS platform

**Incomplete: only isolated runtime prerequisite tools are published; this is not runnable NGS/Workers/Space deployment.**

This initial source-only subset contains private-path macOS arm64 prerequisite
preparers for Python, uv and Node/npm. See
[tool usage and boundaries](tools/runtime-prerequisites/README.md).
Run the documented commands from `tools/runtime-prerequisites/`.

It does not include the NGS application, Workers services, Space deployment,
models, game assets, operational data, identities or credentials. Completing
prerequisite preparation does not complete or activate NGS.

The tools were narrowly exported from source commit
`093489982ad6c32ceba806dfe32e6c9d43bad3b1`. Safety helpers were AST-selected into
`archive_common.py`, integration-only install examples were removed, and internal
provenance paths were omitted. This is a transformed standalone export, not the
full project's original bootstrap directory. Keeping it under
`tools/runtime-prerequisites/` avoids silently replacing a future NGS bootstrap.

## Licensing

No license is assigned here to the newly authored helper code. It must not be
assumed to be open-source-licensed merely because it is visible. Official uv MIT
and Apache-2.0 notices are retained unchanged; they apply to uv, not this helper
code. The tool README explains archive and third-party notice handling.
