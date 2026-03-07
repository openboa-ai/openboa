---
title: "Ouath"
summary: "openboa auth integration: Codex first, other providers later."
---

## Purpose

Define openboa authentication integration policy.

Current target is explicit:

- **Codex integration first**
- other providers are deferred to later phases

---

## OpenClaw Reference

This document references OpenClaw auth/runtime patterns for practical integration flow:

- local credential handling
- callback/refresh/revoke lifecycle
- runtime-safe token usage

openboa adaptation:

- keep Local-First storage
- keep chat/session SOT boundaries
- bind credentials to `agentId` via reference, not raw token spread

---

## Scope (Codex only)

In scope:

- auth start/callback/refresh/revoke for Codex
- local credential storage and agent binding
- runtime usage contract (`credentialRef`)

Out of scope:

- non-Codex providers (planned later)
- multi-provider federation/switching
- enterprise SSO integration

---

## Agent Binding Model

- runtime stores credential objects under local auth path
- each agent stores only `credentialRef`
- session/chat/prompt/context artifacts must not include raw tokens

---

## Lifecycle

```text
unconfigured -> pending_auth -> active -> expired -> refreshed
                                  \-> revoked
```

Flow:

1. `auth.start` -> create state/PKCE + auth URL
2. `auth.callback` -> validate state + exchange token set
3. `token.refresh` -> rotate token set safely
4. `revoke` -> clear local credential material + keep redacted audit

---

## Local Path

- `.openboa/auth/codex/credentials/<credentialId>.json`
- `.openboa/auth/codex/transactions/<txId>.json`
- `.openboa/auth/bindings/agents/<agentId>.json`

---

## Security Baseline

- never write raw tokens to chat/session logs
- mask secrets in runtime/audit output
- on refresh failure, emit `auth_error` and `nextAction=reauth_codex`

---

## Acceptance Criteria

- Codex auth flow works end-to-end
- agent binding uses `credentialRef`
- token leakage is prevented in artifacts
- runtime recovery works from local auth state

---

## Next Phase Note

Provider expansion is intentionally deferred.

After Codex path is stable, add providers as separate extension tracks.
