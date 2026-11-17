# PR-security-dependencies-20261117

- `Title`: Remediate compatible dependency security alerts
- `Branch`: `codex/security-dependencies-20261117`
- `Goal`: Remove the 37 current dependency alerts with same-major official fixes; retain an explicit decision for the one cross-major basic-ftp alert.
- `Metric`: 37 targeted alert entries (33 unique GHSAs) absent from the resulting graph; no existing product, packaging or security regression.
- `Quality target`: Existing behavior and controls pass unchanged; no dismissed alerts or unverifiable fix claims.
- `Owned boundary`: `package.json`, `pnpm-lock.yaml`, [spec revision 1](../../docs/engineering/security-dependencies-20261117/spec.md), and this frontier's wiki records.
- `Acceptance criteria`: Requirement-linked evidence in the specification, independent immutable-diff review, and exact-commit trusted CI; draft PR only.
- `Current status`: `proposed`
- `Current owner`: `auto-pm`
- `Accepted specification`: Revision 1, SHA-256 `bcb4d161a13443b458564365379110ff7576acf07a15e07518c000ae48757fe8`, accepted on 2026-11-17 by the delegated project lead after the fresh security-boundary/compatibility investigator reported no blocker within the same-major boundary. This is lead acceptance for routine authorized maintenance, not new human approval. The accepted source content remains immutable in the initial specification commit.
- `Baseline`: 38 open Dependabot alert entries (34 unique GHSAs; 1 critical, 14 high, 15 medium, 8 low); readable code scanning and secret scanning each return zero open alerts.
- `Current quality gap`: Frozen baseline installation passed. Baseline audit reports 54 advisory records, broader than the 38 GitHub entries. Baseline `pnpm check` stops at an unchanged CI policy exception that expired 2026-10-14; component checks remain pending. The current official follow-redirects advisory requires 1.16.2 rather than the proposed 1.16.1, so that target returns to review. Basic-ftp #214 requires a separately reviewed cross-major mechanism.
- `Latest winning run`: None.
- `Latest failed run`: None.
- `Why this PR is not ready yet`: Revision 1 has lead acceptance, but the current audit requires a corrected follow-redirects target and exposes additional vulnerabilities. No implementation change or published draft PR exists.
- `Open risks`: Existing basic-ftp 5.3.1 is affected and the documented patch is 6.2.4; the unchanged dependency-audit gate will remain failing until that boundary is resolved.
- `Next action`: Review the follow-redirects target correction and newly observed advisories, trace the basic-ftp consumer, and continue baseline component checks before the bounded implementation.
