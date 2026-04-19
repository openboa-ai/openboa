---
title: "Docs"
summary: "Doc landing pages and documentation navigation for openboa."
---

# Docs

Minimal stable docs set for openboa.
Mintlify navigation is configured in `docs/docs.json`, and theme styling is defined in `docs/style.css`.

## Information Architecture

### Overview

- [Docs Portal](./index.md) - Docs home and reading entrypoints.
- [Introduction](./introduction.md) - High-level project orientation and scope.
- [Acknowledgements](./acknowledgements.md) - Influences and upstream acknowledgements.
- [Architecture](./architecture.md) - Current code reality and subsystem boundaries.
- [Business of Agents](./concepts/business-of-agents.md) - BOA definition and core building blocks.
- [Core Doctrine](./concepts/core-doctrine.md) - BOA-0 principles and strategic baseline.
- [System Contracts](./concepts/system-contracts.md) - Philosophy translated into enforceable contracts.
- [Sharp Non-goals](./help/non-goals.md) - Explicit exclusions that protect the doctrine.
- [Network](./network.md) - Governance-aware network and access baseline.
- [FAQ](./help/faq.md) - Fast answers on scope, stage, and intended use.

### Agents

- [Agent Hub](./agents/index.md) - Reading guide for the Agent docs and the recommended order from meaning to reference.
- [Agent](./agent.md) - What the Agent layer is, why it exists, and how to read the rest of the Agent docs.
- [Agent Capabilities](./agents/capabilities.md) - The capability model: session-first truth, proactive revisits, learning, retrieval, execution hand, and safe improvement.
- [Agent Runtime](./agent-runtime.md) - Canonical runtime contract: one-wake flow, runtime objects, artifacts, proactive and learning loops, and promotion model.
- [Agent Workspace](./agents/workspace.md) - The filesystem surface: session execution hand, shared substrate, and runtime catalog.
- [Agent Memory](./agents/memory.md) - Durable shared memory, learn stores, session-local state, and promotion rules.
- [Agent Context](./agents/context.md) - Session truth versus prompt view, retrieval candidates, reread, and context pressure.
- [Agent Bootstrap](./agents/bootstrap.md) - Durable bootstrap substrate and how `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, and `MEMORY.md` become system prompt sections.
- [Agent Architecture](./agents/architecture.md) - Internal architecture: design axioms, layer map, storage, mounts, retrieval, evaluation, and code map.
- [Agent Sessions](./agents/sessions.md) - Reference for session lifecycle, events, wake semantics, and session storage.
- [Agent Environments](./agents/environments.md) - Reference for the reusable local execution substrate contract.
- [Agent Resources](./agents/resources.md) - Reference for session-attached resources, mounts, and promotion-safe writeback.
- [Agent Harness](./agents/harness.md) - Reference for the bounded brain loop and loop-directive interpretation.
- [Agent Sandbox](./agents/sandbox.md) - Reference for the bounded execution hand and shell/filesystem surface.
- [Agent Tools](./agents/tools.md) - Reference for the managed tool contract, ownership model, and permission posture.

### Chat

- [Chat](./chat.md) - Current chat-first product wedge.
- [Chat Kernel](./chat-kernel.md) - Backend-first chat truth, policy, and projections.

### Work

- [Work](./work.md) - Future execution and assetization layer above Chat.

### Observe

- [Observe](./observe.md) - Governance and evidence surface above Work and Agent execution.

### Build

- [Quickstart](./quickstart.md) - Minimal local setup and docs validation flow.
- [Development](./development.md) - Core commands and recommended contribution workflow.
- [Contribution Guide](./contribution-guide.md) - Documentation and contribution conventions.
- [Project Harness](./harness.md) - Generic PR-centric operating model used in this repository.
- [Product Canon](./PRODUCT.md) - Stable product direction, user value, and non-goals.
- [Design Canon](./DESIGN.md) - Stable taste, interaction, and presentation rules.
- [Quality Canon](./QUALITY.md) - Stable quality bar, severity language, and final-signoff expectations.
- [Color Foundation](./foundation/colors.md) - Green/Gray/Sand palettes and semantic token mapping.
- [Docs Troubleshooting](./help/troubleshooting-docs.md) - How to fix common docs link and structure issues.

### Korean Docs

- [Korean Docs README](./ko/README.md) - Index for the Korean documentation tree.
- [Korean Docs Home](./ko/index.md) - Entry page for Korean readers.
- [Korean Introduction](./ko/introduction.md) - Project introduction and reading order in Korean.
- [Korean Agent](./ko/agent.md) - Korean entry page for the Agent surface.
- [Korean Chat](./ko/chat.md) - Korean entry page for the Chat surface.
- [Korean Work](./ko/work.md) - Korean entry page for the Work surface.
- [Korean Observe](./ko/observe.md) - Korean entry page for the Observe surface.
- [Korean Quickstart](./ko/quickstart.md) - Minimal local verification flow in Korean.
- [Korean Development](./ko/development.md) - Core commands and contribution loop in Korean.
- [Korean Architecture](./ko/architecture.md) - Korean overview of the current system structure.
- [Korean Contribution Guide](./ko/contribution-guide.md) - Korean contribution baseline.
- [Korean Business of Agents](./ko/concepts/business-of-agents.md) - BOA model and building blocks in Korean.
- [Korean Core Doctrine](./ko/concepts/core-doctrine.md) - BOA-0 principles in Korean.
- [Korean System Contracts](./ko/concepts/system-contracts.md) - System-contract framing in Korean.
- [Korean Network](./ko/network.md) - Network and governance overview in Korean.
- [Korean Color Foundation](./ko/foundation/colors.md) - Color token baseline in Korean.
- [Korean FAQ](./ko/help/faq.md) - Frequently asked questions in Korean.
- [Korean Non-goals](./ko/help/non-goals.md) - Explicit exclusions in Korean.
- [Korean Docs Troubleshooting](./ko/help/troubleshooting-docs.md) - Docs validation and troubleshooting in Korean.

## Internal memory

The repository keeps active working state outside `docs/`.

- `wiki/` holds PR pages, run pages, frontier ordering, and chronology.
- `raw/` holds evidence and immutable imported materials.
- `.agents/` holds the generic harness behavior and templates.

## Public versus internal

- `docs/`
  - public, canonical, externally meaningful documentation
- `wiki/`
  - internal syntheses, PR memory, run memory, and unstable design reasoning
- `raw/`
  - raw imported source material and immutable evidence

Public docs should not route readers into `wiki/` or `raw/`.
Stable conclusions may be promoted from `wiki/` into `docs/`, but the two layers should remain distinct.
