# First publication: CI staging, human 2FA promotion

New package names are **never directly published** by the release script. Existing initialized packages keep their configured npm Trusted Publisher/OIDC path. This implements the ORI-22 owner's `staged-ci` choice (2026-10-25); it does not authorize host/alpha release work.

## Stage once

1. Review and merge the release change only after PR checks pass. Preserve all normal check, archive, and clean-install gates.
2. Inspect npm **Staged Packages** and previous GitHub release artifacts first. Do not retry an existing or ambiguous stage submission blindly.
3. Run the main `ci.yml` workflow once with `stage_new_packages=true`. Automatic pushes and default manual runs do not opt in to staging new names. The npm `NPM_TOKEN` secret must have scope access to create/stage the new package; it need not bypass 2FA.
4. CI plans versions from fresh registry metadata, validates every archive and tests clean installations. Confirmed earlier publications are not republished.
5. On the first missing name, CI runs `npm stage publish <exact.tgz> --access public --tag latest --json`. It validates the returned name, version, SHA-512 integrity, SHA-1 shasum and stage ID against the exact archive. It then **stops** before later packages, without treating the stage as an online publication.

The `release-<run-id>-<attempt>` GitHub artifact (14-day retention) preserves:

- Exact checked `.tgz` archives.
- `first-publication-stage.json`: submitted archive hashes/size, name/version, source commit, content fingerprint, run identity and stage ID.
- `publication-result.json`: `awaiting-promotion`, never `published`, for a staged release.

A submission intent is written **before** the npm request. A transport or malformed-ack failure records `stage-unconfirmed` and fails CI; it does not retry. npm 11 JSON is keyed by package name; the exact output is now retained with credentials redacted before validation. Inspect the actual npm queue and exact archive before any further action. A failed client command may have reached npm.

### Recovery of run 40184840188

This run returned successfully from the npm stage command, but the original parser incorrectly expected a flat object. npm created a `0.0.0-stage` placeholder, **not the operational version**. Do not run release/stage again. The manual main-only `recover-first-stage.yml` workflow only lists/views/downloads the existing stage; it cannot approve, reject or publish. It downloads the original run artifact and checks its fixed source/fingerprint/run identity and SHA-256, then requires exactly one matching pending npm stage and a downloaded tarball identical in size, SHA-1, SHA-512 and SHA-256. It preserves a recovered stage receipt for human review. Zero/duplicate/mismatched entries fail closed and require inspection, never an automatic retry. Registry placeholders are explicitly blocked by release planning and cannot be mistaken for an initialized release.

## Human review and promotion

The owner reviews the exact stage ID/package/version and source against the CI artifact, opens npmjs.com's **Staged Packages** tab, and approves with interactive 2FA. Approval is not done by the agent, and no OTP/token belongs in chat or repository files. Reject an unexpected package/version or artifact; do not approve by name alone.

Before approval the package is **not installable**. A successful/green staging job, a stage ID, or package settings appearing is not publication success.

After package creation, configure its GitHub Actions Trusted Publisher with user `chengzhiyi`, repository `pi-extensions`, workflow filename `ci.yml`, no environment. Existing direct-publish policy must permit `npm publish`; if the package is required to remain stage-only, adapt the subsequent release workflow instead of weakening that policy.

## Resume only after promotion and OIDC setup

Run `ci.yml` on main **without** `stage_new_packages`. Revalidate npm's exact version/content receipt and tarball integrity first. The normal planner skips the promoted unchanged package, preserves its original source receipt and continues remaining dependency-ordered releases. A registry package with no usable latest version fails closed instead of becoming another first-publication attempt.

Only when **all** planned publications are confirmed does CI emit `published=true` and sync version manifests to main. During staging it emits `published=false`, skips that sync and gives an explicit `STAGED ONLY, NOT PUBLISHED` summary.

Finally verify a clean real npm install and the accepted host's real npm-backed activation/drawing/save/lifecycle. Do not substitute local archives or registry fixtures. Keep previously approved platform skips distinct from passes.

## Official references

- [New packages can be created by staged publishing, including stage-only granular tokens](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/)
- [Staged publishing: maintainer approval requires 2FA](https://docs.npmjs.com/staged-publishing/)
- [Trusted publisher fields and allowed actions](https://docs.npmjs.com/trusted-publishers/)
