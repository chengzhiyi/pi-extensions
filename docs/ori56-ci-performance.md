# ORI-56: bounded CI performance improvements

## Changes

- Archive validation now performs two preflight listings and one extraction into
  a private temporary directory, instead of running `tar -xOf` (and scanning the
  gzip stream) once per resource. The Excalidraw build currently has 427 resources.
- Before extraction, reject duplicate members, absolute/traversal paths, symlinks,
  hardlinks and special files. Cleanup runs even when inspection fails. Existing
  manifest, resource size/hash, entrypoint, allowlist and workspace-version checks
  still run. No new dependencies or lockfile changes.
- CI installs only Playwright's Chromium headless shell, plus OS dependencies.
  Existing tests use the default `chromium.launch({headless: true})` path.
- Both jobs cache only npm's content-addressed download cache (`~/.npm/_cacache`),
  not credentials, logs or installed trees. Standalone archive installs remain in
  a fresh external temporary directory and use `--prefer-offline` (not offline).
- Pack, archive validation, standalone installation, smoke and npm publish commands
  log elapsed time, including failures, and append timing rows to the step summary.
  Registry confirmation reports each attempt, elapsed time, latest version and
  fingerprint match state, without printing raw registry responses or credentials.

## Measured result

On the same real Excalidraw tarball, Node 24 / local macOS, single-run comparison:

| Validator | Time |
|---|---:|
| Original implementation from the parent commit | 77.883 seconds |
| New implementation | 1.795 seconds |

This measures only archive validation (~43x faster), not the entire CI. Filesystem
load and Linux runner performance differ. The standalone installation smoke also
passed; one local run reported npm installation at 76.24s, so download caching and
separate timing remain useful even after fixing the archive scan.

## Verification

- `pnpm install --frozen-lockfile`
- `node --test scripts/*.test.mjs`: 44 passed, including malicious archive fixtures,
  pending/confirmed registry logging and success/failure timing summary checks.
- `pnpm check`, `pnpm test`, `pnpm build`: passed.
- `pnpm pack:check`: passed, including installed plugin and hosted-runtime smoke.
- `pnpm --filter @chengzhiyi/pi-excalidraw test:browser`: passed with headless shell.
- Additional `test:csp` with an explicitly supplied newly packed archive reached
  the browser but timed out waiting for the PNG download event at line 102. This
  extra test is not part of the existing CI `pnpm test` command. No application
  source was changed; do not claim this extra check passed. Its default archive
  path also refers to version 0.1.0, so set `PI_EXCALIDRAW_TGZ` when running manually.

## Deliberately unchanged

The original run spent 319 seconds waiting for npm asynchronous processing. This
patch does not pretend to remove that external delay: exact version+fingerprint
confirmation, dependent publication ordering, OIDC/provenance, staged first-version
human promotion and version-sync gates remain unchanged. Publish still rechecks
latest main after acquiring the release queue slot. No blanket reuse of stale
verification or pre-version-bump archives, no shortened confirmation timeout and
no automatic retry of ambiguous publication.

Splitting code-check and publication workflows or replacing runner waiting with a
persisted asynchronous release state machine is a separate architectural change;
it is not necessary for these bounded improvements and is not included here.
