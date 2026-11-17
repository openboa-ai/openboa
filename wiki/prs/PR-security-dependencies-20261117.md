# PR-security-dependencies-20261117

- `Title`: Remediate compatible dependency security alerts
- `Branch`: `codex/security-dependencies-20261117`
- `Goal`: Remove the 37 current dependency alerts with same-major official fixes; retain an explicit decision for the one cross-major basic-ftp alert.
- `Metric`: 37 targeted alert entries (33 unique GHSAs) absent from the resulting graph; no existing product, packaging or security regression.
- `Quality target`: Existing behavior and controls pass unchanged; no dismissed alerts or unverifiable fix claims.
- `Owned boundary`: `package.json`, `pnpm-lock.yaml`, [spec revision 1](../../docs/engineering/security-dependencies-20261117/spec.md), and this frontier's wiki records.
- `Acceptance criteria`: Requirement-linked evidence in the specification, independent immutable-diff review, and exact-commit trusted CI; draft PR only.
- `Current status`: `open`
- `Current owner`: `auto-coding`
- `Accepted specification`: Revision 2, SHA-256 `b269ef1a57e8d6dbc6ce8640c3a666ecff4e471eee2980672bd7135888043b01`, accepted on 2026-11-17 by the delegated project lead after fresh independent boundary/compatibility review reported no blocker. This is lead acceptance for routine authorized remediation, not new human approval. Revision 1 remains recorded in `cdb463c2e7f8a955deccda85f46523fb72fc310e`; revision 2 is committed before dependent edits.
- `Baseline`: 38 open Dependabot alert entries (34 unique GHSAs; 1 critical, 14 high, 15 medium, 8 low); readable code scanning and secret scanning each return zero open alerts.
- `Current quality gap`: Frozen installation and all baseline component checks passed, including 501 tests. The unchanged policy gate fails on the exception that expired 2026-10-14. Proposed specification revision 2 consolidates the wider 49-GHSA registry audit and corrects follow-redirects to 1.16.2; its 16 compatible package targets have reviewed acceptance. Basic-ftp, katex, zod and minimatch range changes remain blocked.
- `Latest winning run`: No implementation run; baseline recorded in `RUN-20261117-security-dependencies-baseline`.
- `Latest failed run`: None.
- `Why this PR is not ready yet`: Accepted revision 2 implementation and candidate verification are pending; four range-boundary packages and the unchanged expired policy exception remain explicit blockers.
- `Open risks`: Existing basic-ftp 5.3.1 is affected and the documented patch is 6.2.4; the unchanged dependency-audit gate will remain failing until that boundary is resolved.
- `Next action`: Implement the 16 accepted compatible targets and focused dependency-boundary regression test, then rerun audit and required checks. Any further range-boundary decision returns to a reviewed specification revision.
