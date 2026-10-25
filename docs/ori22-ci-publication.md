# ORI-22: GitHub CI release preparation

User authorization: Paperclip ORI-22 comment `bb821665-eb90-448d-8c51-753ffface2e7` requests publishing the Excalidraw plugin through GitHub CI and then verifying the published package. Host alpha integration/publication is not included.

## Source and changes

- Accepted plugin implementation: `7e5773d16ed17e4bc400838f8ee5e23caf87cce1`.
- The existing workflow publishes from `main` only after verification. This PR preserves that restriction and the first-publication readiness gate.
- Add the Excalidraw workspace importer and dependencies to `pnpm-lock.yaml`.
- Link the build-time protocol dependency with `workspace:*`, so the release planner/packer pins the exact newly selected protocol version.
- Provision Chromium (including Linux system dependencies) in both jobs that execute the browser-backed scene-adapter test.
- Make font tests read pinned vendor inputs instead of requiring pre-existing `dist` from a prior build. Keep the complete real WOFF2 assertions, and assert that the font set is nonempty.
- Extend clean tarball installation verification to import the exact installed v2 backend and check health, tool declarations, persistent-state CAS, generation rejection and disposal. Existing v1 verification and strict archive/resource checks remain.

## Local verification

Fresh worktree, Node 24.21.0 / pnpm 10.18.1:

- Frozen-lockfile dependency installation: PASS after adding the missing importer.
- Production audit: PASS, no known vulnerabilities.
- Check: PASS.
- Tests: 99 PASS (21 release scripts + 7 protocol + 54 v1 plan plugin + 17 Excalidraw).
- Build: PASS.
- Strict archive enumeration/hash checks and independent archive installation: PASS, including the new installed-v2 smoke.
- First clean test run failed because the font test read nonexistent `dist/fonts/Excalifont`; the corrected run retains the font checks and reads the installed pinned source. This failure is not represented as a pass.

## Publication readiness

At preparation time, the GitHub repository's Actions secrets list is empty; npm Excalidraw metadata returns404. Existing protocol/plan-mode packages have an OIDC publication history, but the new package still requires authorized first-publication setup under the existing workflow.

A successful PR verification is not npm publication. A workflow whose publish job is skipped is not npm publication. Do not bypass the readiness gate, introduce credentials in source/logs, or use a local direct publish to substitute for the requested GitHub CI.

The shared-lockfile fingerprint may cause the existing protocol and plan-mode packages to receive compatible patch releases too. The release planner chooses versions from fresh registry metadata and publishes in dependency order; do not force versions or overwrite an existing npm version.

## Main-run authentication failure and bounded repair

Main CI run `40175044561` verified all packages and clean archives, but failed at
`@chengzhiyi/pi-web-protocol@0.1.1`: npm returned `EOTP`, requiring an interactive
one-time password. No Excalidraw publication occurred. The publisher's exact-receipt
confirmation then waited its bounded 15 minutes; elapsed runtime was not success.

The workflow had passed its new-package bootstrap token to **every** npm publish,
so existing packages did not retain their previously successful tokenless OIDC
path. The publisher now selects child-process authentication from fresh registry
state: existing names clear `NODE_AUTH_TOKEN` and `NPM_TOKEN` while retaining the
GitHub OIDC environment; new names require and keep the bootstrap credential.
Regression tests verify per-package isolation, unchanged caller environment,
retained OIDC capability and fail-closed new-package authentication. This does not
disable 2FA, change npm security settings, initialize a missing package via OIDC,
or guarantee the new token has sufficient permission; actual main CI remains the
authority. No local publishing is used.

## Online verification after CI publication

1. Confirm the CI publish job succeeded, not just verify, and record the run URL and published-source SHA.
2. Query exact npm metadata, release fingerprint/source, selected version and tarball integrity.
3. Download/install the actual registry archive in a clean environment, with no local-tgz override, then repeat controlled resource/backend lifecycle checks.
4. Use the already-accepted host feature worktree for actual registry-backed management install/activation/drawing/lifecycle verification. Do not claim the unchanged alpha already supports the new runtime.
5. Upgrade tests require distinct real published versions; if only one exists, record that boundary instead of substituting local archives or silently publishing a dummy version.
