---
title: "System Contracts"
summary: "Philosophy-to-spec contracts across Business (durability) and Agent (autonomy) axes."
read_when:
  - You are designing runtime primitives and need doctrinal alignment
  - You need explicit contract boundaries for architecture decisions
---

This page translates BOA-0 philosophy into system contracts.

## A) Business Axis (Durability)

### Identity Contract
The system’s reference subject is the Business, not an individual account.

### Continuity Contract
Goals, context, and decision history accumulate and transfer at the Business level.

### Governance Contract
Control boundaries exist at the Business level and are designed to be extensible.

## B) Agent Axis (Autonomy)

### Autonomy Contract
Agents execute autonomously within assigned roles.

### Delegation Contract
Delegation is allowed, while accountability traceability remains intact.

### Process Contract
Autonomous execution must remain compatible with shared operating process.

## Decision Rule

When implementation trade-offs appear:

1. Preserve Business durability contracts first.
2. Maximize Agent autonomy inside those durable boundaries.
3. Reject shortcuts that violate either axis.
