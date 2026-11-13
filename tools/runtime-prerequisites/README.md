# Private-path macOS prerequisite preparers

Standalone preparation tools for pinned Python 3.12.14, uv 0.13.7, and Node
24.21.0 with npm 11.19.0, for macOS arm64. These tools do not activate services,
install application dependencies, run models, or modify global PATH, shell
profiles, NVM installations or existing executables.

## Use

An existing Python 3.9+ interpreter runs these stdlib-only helpers. Use a new
absolute destination under an existing owner-trusted, non-shared-writable parent.
Default is an offline plan:

```sh
python3 bootstrap/prepare_trusted_python.py --root "$HOME/Workspaces/private-python"
python3 bootstrap/prepare_trusted_uv.py --root "$HOME/Workspaces/private-uv"
python3 bootstrap/prepare_trusted_node.py --root "$HOME/Workspaces/private-node"
```

For any helper, add `--archive /absolute/owned/path/archive --apply` to prepare
from an existing archive. Alternatively, `--download` explicitly downloads and
applies the one pinned official archive; it is not a preview. Do not combine the
two archive sources. No payload is executed by these helpers.

Results expose absolute Python, uv/uvx, or Node/npm paths. Use Node's returned
`npmInvocation` to avoid selecting another global Node through the npm shebang.
Application dependency installation and service activation are separate and are
not included in this snapshot.

## Safety and boundaries

Archive SHA256 is verified on a private snapshot before tar parsing/extraction.
Traversal, escaping links, special files, unsafe modes and existing destinations
are rejected. Internal links are retained only when safe. An exclusive sibling
intent prevents automatic retries after an uncertain or failed attempt. Inspect
a failure before choosing a new destination; never delete unfamiliar files.
Only this invocation's temporary files are cleaned up. macOS exclusive rename is
required. No global permissions are changed.

Initial download URLs, platform, layouts, checksums and size bounds are pinned.
GitHub downloads permit only approved HTTPS GitHub asset redirects; Node uses
only HTTPS nodejs.org. Ambient proxy/credential settings are not inherited.
Provenance and its limits are recorded honestly in each manifest. These are
checksum checks, not independent signature verification or runtime certification.

## Tests

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s bootstrap/tests -p 'test_trusted_*.py'
```

The ten tests use inert miniature archives, never downloaded payloads or model
inference. Run on macOS arm64 because publication uses macOS exclusive rename.

## Rights and notices

No license has been assigned to this snapshot's newly authored helper code.
Public availability does not itself grant an open-source
license or redistribution permission. Resolve this separately before broader use.

The official uv MIT and Apache-2.0 notices are included unchanged under
`bootstrap/notices/uv-0.13.7/`. They were collected separately from the official
same-version source tag: the uv binary archive contains no LICENSE files. The
uv helper verifies and copies both notices. These licenses do not license the
new helper code. Python and Node archives retain their own included notices;
Node includes npm's Artistic-2.0 and dependency notices. Bundled third-party terms
remain applicable; this is not comprehensive redistribution-rights clearance.

This source-only snapshot excludes applications, Workers, game data, operational
settings, identities, credentials, Git history and downloaded binaries.
