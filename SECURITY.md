# Security Policy

## Reporting a Vulnerability
Please do not open public issues for security vulnerabilities.

Use GitHub Security Advisories for private reports on this repository.
If you cannot access advisories, contact a maintainer privately and include:
- affected component
- impact
- reproduction steps
- suggested remediation

## Secret Handling Rules
- Never commit real API keys, tokens, or credentials.
- Use `.env` for local secrets.
- Keep `.env.example` non-sensitive.
- Run `pre-commit run --all-files` before opening PRs.

## Secret Rotation
If a secret is exposed:
1. Revoke/rotate the secret immediately.
2. Remove leaked values from runtime/config.
3. Replace history if required by provider policy.
4. Open a remediation PR and describe impact.

