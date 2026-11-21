# NGS prepared release candidate

GitHub Actions runs the preparation workflow after a push to this repository's
`main`. It validates the pinned Node/Workerd fixtures and uploads a
source-only artifact. There is no deploy job, production environment,
self-hosted runner or private provider configuration in this workflow.
Repository branch protection/review remains a separate repository setting.

The GitHub artifact is `ngs-local-source-<headSha>-<runAttempt>`, with only:

- `ngs-local.tar`: the uncompressed Git tar of `<headSha>:ngs-local`; archive
  members are relative to that tree and their mtime is the commit time.
  The package excludes hosting scaffolds, Git metadata, caches, dependencies,
  runtime databases, keys and generated assets.
- `release.json`: `ngs.ops-release.v1` binds the archive SHA-256/byte size to
  the repository, workflow path, head commit, run ID/attempt and Node version.
  Its Space descriptor pins the checked-in overlay tree; source-contract
  tests are not a hosted build and do not carry a private Sites scaffold.

OPS should use GitHub's authenticated run/artifact metadata, require the
expected workflow and successful same-repository `main` push at the exact
candidate SHA, then verify the artifact ZIP digest and the inner tar digest.
The manifest alone is not authorization to deploy, and its presence alone
is not proof of successful CI. The source bundle expires after 14 days;
select an unexpired verified artifact for the exact commit, not “latest”.
The actual operation remains a separate, explicit OPS action.

For a fixture-only validation (no deployment):

```sh
npm ci --prefix ngs-local/local-miniflare --ignore-scripts --no-audit --no-fund
bash tools/release/validate-ngs-source.sh
```

GitHub reference: [Workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)
and [Actions artifact REST metadata](https://docs.github.com/en/rest/actions/artifacts).
