# NGS local application

Production source for the standalone local NGS project workspace. Node.js 24 or later; no npm dependencies.

```sh
npm test
NGS_AUDIO_WORKSPACE_ENABLED=1 npm start
```

The service listens on local port 5274 by default and uses separately operated PDS and Request Service loopback MCP endpoints (8030 and 8770). Keep the catalog replica outside this Git tree. Set `NGS_BRAND_MARK_PATH` to an optional local PNG if you want to use your own logo. With no local logo the application starts normally.

This directory contains source, tests and a source-integrity manifest only. Do not commit runtime databases, generated media, project data, private deployment settings or credentials.
