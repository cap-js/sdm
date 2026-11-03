## Fix BlackDuck CI auth failure and upgrade Node.js to 22.23.4 across all workflows

### Background

Two issues addressed in this PR:

1. **BlackDuck scan was failing with E401** — the "Setup npm registry and pin SAP tarballs" step was writing a `~/.npmrc` with an expired/invalid `NPM_AUTH_TOKEN` for a private registry host. BlackDuck only scans production dependencies (`--detect.npm.dependency.types.excluded=DEV`), and all SAP packages (`@sap/cds-mtxs`, `@sap/cds-dk`) are publicly available on npm — the private auth step was never necessary.

2. **CVE-2025-7928 (Node2Shell)** — Node.js versions below 22.23.4 are affected by a Brotli decompression vulnerability that can lead to arbitrary code execution or DoS. Node.js 20 is EOL and will not receive a patch. All workflows pinned to `22.23.4`.

### Changes

**`blackduck.yml`**
- Removed entire "Setup npm registry and pin SAP tarballs" step (was patching `package.json` files and writing `.npmrc` auth for a private registry — unnecessary for a public-npm-only scan)
- Added `Setup Node.js environment` step (`actions/setup-node@v4`, `22.23.4`) consistent with all other workflows

**`cfdeploy.yml` · `deploy_and_Integration_test.yml` · `multiTenant_deploy.yml` · `multiTenant_deploy_and_Integration_test.yml`**
- Removed "Setup npm registry and pin SAP tarballs" step (private auth + `jq` patching of `package.json`)
- Replaced `npm i -g "${{ secrets.SAP_CDS_DK_TARBALL }}"` with `npm i -g @sap/cds-dk@9` — installs the same tool from public npm; `@sap/cds-dk@9.x` is publicly available and equivalent
- Node.js version: `20.x` → `22.23.4`

**`SingleTenant_integration_test.yml` · `MultiTenantintegration_test.yml`**
- Node.js version: `'20'` → `'22.23.4'` (all job steps)

**`unit.tests.yml`**
- Matrix `node-version`: `[20.x]` → `[22.23.4]`

### Secrets that are now unused and can be removed from the `dev` environment

| Secret | Reason |
|---|---|
| `SAP_CDS_DK_TARBALL` | Replaced by public `@sap/cds-dk@9` |
| `SAP_CDS_MTXS_TARBALL` | Was only used in multi-tenant tarball pinning step, now removed |
| `NPM_AUTH_TOKEN` | Was only used to authenticate tarball downloads |

### Notes

- `@sap/cds-dk` and `@sap/cds-mtxs` are fully available on public npm (`9.9.7` and `3.9.8` respectively at time of change)
- Node.js 22 LTS reaches EOL in April 2027 — plan to bump to `^24.x` before then
- `release.yml` was already on Node.js 24 — not changed
