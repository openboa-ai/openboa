# PR-security-dependencies-20261117

- `Title`: Remediate compatible dependency security alerts
- `Branch`: `codex/security-dependencies-20261117`
- `Goal`: Remove all 38 current dependency alert entries using reviewed official fixes, including one explicitly scoped get-uri/basic-ftp exception.
- `Metric`: 38 targeted alert entries (34 unique GHSAs) absent from the resulting graph; no existing product, packaging or security regression.
- `Quality target`: Existing behavior and controls pass unchanged; no dismissed alerts or unverifiable fix claims.
- `Owned boundary`: `package.json`, `pnpm-lock.yaml`, [spec revision 1](../../docs/engineering/security-dependencies-20261117/spec.md), and this frontier's wiki records.
- `Acceptance criteria`: Requirement-linked evidence in the specification, independent immutable-diff review, and exact-commit trusted CI; draft PR only.
- `Current status`: `open`
- `Current owner`: `auto-project`
- `Accepted specification`: Revision 4, SHA-256 `1468eb7b83292ec952bdedcf990fe55a41c67228b5a309dbf6a4c1fe0b4a213a`, accepted by the delegated project lead after independently confirmed consumer regression review; recorded at 2026-11-17T10:59:02+00:00. This is routine lead acceptance, not new human approval. Earlier accepted revisions are recorded in `cdb463c2e7f8a955deccda85f46523fb72fc310e`, `b7fe181` and `bcc6ba5`; revision 4 is committed before the lasting CLI2 compatibility control.
- `Baseline`: 38 open Dependabot alert entries (34 unique GHSAs; 1 critical, 14 high, 15 medium, 8 low); readable code scanning and secret scanning each return zero open alerts.
- `Current quality gap`: The candidate graph removes all 38 original alert entries / 34 unique GHSAs, and the 512-test component suite plus unsigned desktop packaging pass. The smol-toml 1.9.0 attempt was discarded after real CLI2 TOML rule-option controls failed. Revision 4 preserves baseline smol-toml and leaves four audit GHSAs in smol-toml, katex, zod and minimatch plus the unchanged expired policy gate. Final exact-head verification and independent review remain.
- `Latest winning run`: `RUN-20261117-security-dependencies-remediation`; actual final focused set passes 16 tests / 4 files, and all original alert GHSAs are absent from the candidate audit.
- `Latest failed run`: Smol-toml 1.9.0 candidate fails the actual CLI2 inline TOML per-rule option control; this dependency change was discarded.
- `Why this PR is not ready yet`: Accepted revision 4 final verification and independent review are pending; four consumer-boundary packages and the unchanged expired policy exception remain explicit blockers.
- `Open risks`: Smol-toml, katex, zod and minimatch retain four known audit GHSAs. The pre-existing get-uri download rejection path can produce an empty stream and unhandled rejection; no application/consumer shim is included. The all-severity dependency audit and expired-exception policy gate remain blocking; draft delivery does not claim full remediation.
- `Next action`: Reconcile the final exact-head verification handoff, obtain one fresh immutable-diff review and publish a draft PR through the delegated delivery owner. Four audit GHSAs and the expired policy gate remain explicit blockers; merge and deployment remain prohibited.
