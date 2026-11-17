# PR-security-dependencies-20261117

- `Title`: Remediate compatible dependency security alerts
- `Branch`: `codex/security-dependencies-20261117`
- `Goal`: Remove all 38 current dependency alert entries using reviewed official fixes, including one explicitly scoped get-uri/basic-ftp exception.
- `Metric`: 38 targeted alert entries (34 unique GHSAs) absent from the resulting graph; no existing product, packaging or security regression.
- `Quality target`: Existing behavior and controls pass unchanged; no dismissed alerts or unverifiable fix claims.
- `Owned boundary`: `package.json`, `pnpm-lock.yaml`, [spec revision 1](../../docs/engineering/security-dependencies-20261117/spec.md), and this frontier's wiki records.
- `Acceptance criteria`: Requirement-linked evidence in the specification, independent immutable-diff review, and exact-commit trusted CI; draft PR only.
- `Current status`: `open`
- `Current owner`: `auto-coding`
- `Accepted specification`: Revision 3, SHA-256 `e46629b560beb12d4df23b87e91bb50696b0aa731fc6d68668246b9bc0d71a52`, accepted on 2026-11-17 by the delegated project lead after independent review of the get-uri consumer/API/secure-default boundary. This is routine delegated lead acceptance, not new human approval. Revision 1 is recorded in `cdb463c2e7f8a955deccda85f46523fb72fc310e`, revision 2 in `b7fe181`; revision 3 is committed before FTP-dependent edits.
- `Baseline`: 38 open Dependabot alert entries (34 unique GHSAs; 1 critical, 14 high, 15 medium, 8 low); readable code scanning and secret scanning each return zero open alerts.
- `Current quality gap`: Frozen installation and all baseline component checks passed, including 501 tests. The unchanged policy gate fails on the exception that expired 2026-10-14. Proposed specification revision 2 consolidates the wider 49-GHSA registry audit and corrects follow-redirects to 1.16.2; its 16 compatible package targets have reviewed acceptance. Revision 3 additionally accepts scoped basic-ftp 6.2.6 with secure defaults and real FTP controls. Katex, zod and minimatch range changes remain blocked.
- `Latest winning run`: No implementation run; baseline recorded in `RUN-20261117-security-dependencies-baseline`.
- `Latest failed run`: None.
- `Why this PR is not ready yet`: Accepted revision 3 implementation and candidate verification are pending; three range-boundary packages and the unchanged expired policy exception remain explicit blockers.
- `Open risks`: Katex, zod and minimatch retain three known audit GHSAs. The all-severity dependency audit and expired-exception policy gate remain blocking; draft delivery does not claim full remediation.
- `Next action`: Implement accepted revision 3 targets, including get-uri-scoped basic-ftp and bounded FTP/parser controls, then rerun audit and required checks. Any further range decision returns to a reviewed specification.
