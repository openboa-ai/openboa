# RUN-20261117-security-dependencies-baseline

- `PR`: `PR-security-dependencies-20261117`
- `Triggered by`: User request to inspect and remediate organization security issues with draft PR delivery.
- `Owner skill`: `auto-pm` followed by baseline investigation for `auto-coding`.
- `Baseline`: `475019c4a4baabaf78fed46110bb2b21fb1afc37`; Node 24.5.0, pnpm 10.23.0.
- `Hypothesis`: Official compatible dependency patches can remove the current alert entries without changing product code or weakening controls.
- `Single bounded change`: None; only specification and frontier records were prepared. Accepted specification revision 1 was recorded in commit `cdb463c2e7f8a955deccda85f46523fb72fc310e` before dependent edits.
- `Measurement`: GitHub inventory has 38 alert entries / 34 unique GHSAs (1 critical, 14 high, 15 medium, 8 low). Official registry audit reports 54 advisory records / 49 unique GHSAs / 55 occurrences (1 critical, 19 high, 26 moderate, 9 low).
- `Evidence`: Frozen install with scripts disabled passed. The unmodified full `pnpm check` failed at `check:policy` because the tracked merge-canary exception expired on 2026-10-14. Individual `format:check`, `lint`, `typecheck`, `build:web`, full `test` (501 tests / 57 files), `check:docs`, `docs:linkcheck`, and `docs:validate` (71 routed pages) passed. They do not replace the failed aggregate policy gate.
- `Security reproduction`: The actual installed docs Express dependency resolves proxy-addr 2.0.7. With request peer `203.0.113.12` and forged forwarded address `192.0.2.123`, trust subnets `::ffff:10.0.0.0/8` and `::/1` incorrectly returned the forged address. Correctly scoped `10.0.0.0/8` and `::ffff:10.0.0.0/104` returned the peer and still trusted `10.1.2.3`.
- `Compatibility finding`: The XML parser consumer pins 5.7.3 exactly and uses XMLParser PHPDoc options (`ignoreAttributes: false`, `attributeNamePrefix: "@_"`, string tag/attribute values, HTML entities, array tags). A scoped same-major override and legitimate parser fixture are proposed in specification revision 2.
- `Quality axis targeted`: Dependency security and compatibility.
- `Net quality delta`: Baseline evidence and a more complete inventory; no vulnerability is yet fixed on this branch.
- `Decision`: Return revised scope for review. Keep basic-ftp, katex, zod and minimatch major/range changes blocked and preserve the expired policy gate.
- `Next recommended owner`: `auto-project` to reconcile revision 2, then the single `auto-coding` writer for accepted compatible targets.
