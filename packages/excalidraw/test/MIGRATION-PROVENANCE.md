# ORI-31 migrated regression provenance

Host source base: `05fbf44`; plugin source base: `c54e0b6`. Runtime/editor code is unchanged by ORI-31. Build/pack produces exactly the same SHA-256 `6eee13fe4dab6d68b20d17a0fe68741eba79dc085097149e609678b667c09f31` as the parent's integrated-CSP tgz (426 resources). No font/observer regression fix was reverted.

## Active, executed plugin domain regressions

Of the host's original 13 drawing Node tests:

- `diagram-drawing.test.ts`: all **3** live in `drawing.test.ts` (previous extraction).
- `diagrams.test.ts`: **3** validators in `domain.test.ts` (previous extraction); **1** store/candidate/session/hand-edit/save/open case now in `store-parity.test.ts`, using broker-backed file fixtures instead of a host-owned domain filesystem implementation.
- `diagram-recovery.test.ts`: **1** in `recovery.test.ts` (previous extraction), strengthened for same-origin preexisting backup keys on both matching and unavailable IDs. Matching recovery is explicit; missing IDs never materialize old arguments or send writes.

These **8/8** plugin-owned domain/model tests are actually executed by `npm test`, not archived-only. Other plugin tests cover actual runtime CAS, broker calls, archive resource verification, isolated-realm observers and complete-font CSP safety. The new metadata/stale-candidate migration test adds exact checkpoint/focus/diskHash/savedRevision equality across runtime restart. Build before testing: the font regression reads built font resources.

## The other 5 old host tests: boundary replacement, not a dropped domain

- The **1** native filesystem test is replaced by host `drawing-file-broker-parity.test.ts` plus existing `hosted-plugins.test.ts`; broker file boundaries now live in the host, while plugin `runtime.test.ts` tests path/JSON/scene validation before importing files.
- The **2** old builtin persistence tests are replaced by host `legacy-checkpoints.test.ts`, actual-tgz migration/restart/reinstall checks, independent-broker CAS/generation tests and plugin runtime restart/stale-candidate coverage. The host retains only an opaque loader and test-only cooperative writer, not the removed drawing domain.
- The **1** builtin HTTP/enablement test is replaced by default-absence assertions (`plugin-management.test.ts`) and actual hosted authenticated HTTP lifecycle, scope, policy and generation tests.
- The **1** builtin SDK test is replaced by existing actual hosted retained-SDK adapter/integration tests and the full-host production browser lifecycle (deterministic SDK model transport, real worker/tgz). No provider network acceptance is claimed.

`legacy-source/` preserves original removed boundary test source for audit. It is NOT runnable against the removed builtin imports, NOT included in the `test/*.test.ts` command and NOT counted as passing. It is not distributed in the plugin package.

## Historical native-browser matrix

`legacy-browser/` preserves the seven original host builtin suites/helper. These depend on the old builtin HTTP test harness and are reference source, **not active hosted browser tests and not counted as passing**. The active hosted full-host lifecycle and strict-CSP package browser tests were executed separately. Detailed Mermaid/menu/card/group/theme/import/export/IME/multiwindow/performance matrix conversion remains a parent acceptance gate; do not infer those checks from the narrower lifecycle run. The host no longer runs suites against a deliberately removed API.
