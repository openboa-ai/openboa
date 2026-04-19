# BOA-0 Core Doctrine

## Core State

openboa solves the operational leverage gap that appears when turning ideas into sustained execution.

This project is not built on the assumption that ideas are scarce.
It is built on the observation that sustained execution is scarce.

Most ideas fail before validation because operators run out of time, coordination capacity, and continuity.
openboa exists to reduce that execution drag at the system level.

---

## Why This Matters Now

AI lowered the cost of producing outputs.
It did not automatically solve the cost of running a business process over time.

The real bottleneck is operational leverage:

- keeping execution active without constant manual prompting
- preserving context as people/agents/tools change
- maintaining accountable delegation while scaling work

openboa treats this as an operating-system problem, not a single-agent problem.

---

## Core Values

### 1) Execution Leverage First

The value of openboa is measured by how much operational leverage it creates for real execution,
not by how many features it ships.

- Never compromise: execution leverage as the primary value function
- Flexible: non-essential expansion

### 2) Business as the Durable Operator

The durable operating subject is the Business itself.
People, agents, and tools may change, but business continuity must remain intact.

- Never compromise: durability of the Business as the operating subject
- Flexible: person-first or tool-first optimization

### 3) Autonomy + Process

Performance comes from agent autonomy.
Durability comes from stable process.
openboa treats both as required conditions, not trade-off options.

- Never compromise: autonomy and process must co-exist
- Flexible: short-term convenience-first approaches

---

## Core Philosophy

1. We solve execution problems, not idea problems.
2. The durable operating subject is the Business.
3. Performance comes from autonomy; durability comes from process.

---

## Decision Tensions (How We Choose)

When priorities conflict, use this order:

1. Preserve Business durability.
2. Preserve accountable process.
3. Maximize agent autonomy inside those boundaries.
4. Prefer leverage gains over feature expansion.

If a proposal violates (1) or (2), it should not ship in its current form.

---

## Philosophy -> Spec (System Contracts)

## A) Business Axis (Durability)

### Identity Contract

The system’s reference subject is the Business, not an individual account.

**Violation example:** business-critical state tied to a single user identity.

**Expected behavior:** business identity and authority remain durable across personnel/tool changes.

### Continuity Contract

Goals, context, and decision history accumulate and transfer at the Business level.

**Violation example:** operational memory resets whenever a worker/agent is replaced.

**Expected behavior:** successor workers inherit the business context required for continuity.

### Governance Contract

Control boundaries exist at the Business level and are designed to be extensible.

**Violation example:** governance only exists as ad-hoc operator behavior.

**Expected behavior:** policy boundaries can evolve without redefining business identity.

## B) Agent Axis (Autonomy)

### Autonomy Contract

Agents execute autonomously within assigned roles.

**Violation example:** every action requires direct human micromanagement.

**Expected behavior:** agents can progress tasks without continuous prompts.

### Delegation Contract

Delegation is allowed, while accountability traceability remains intact.

**Violation example:** delegated outcomes cannot be attributed or audited.

**Expected behavior:** key execution paths remain attributable at decision level.

### Process Contract

Autonomous execution must remain compatible with shared operating process.

**Violation example:** each agent invents incompatible operating loops.

**Expected behavior:** autonomy expresses through a common process backbone.

---

## Sharp Non-goals

1. openboa is not a vertical, domain-locked solution.
2. openboa does not optimize for feature count or demo theatrics as primary outcomes.
3. openboa does not sacrifice autonomy for process, or process for autonomy.
4. openboa does not prioritize person/tool convenience over Business continuity.
5. openboa does not shift core doctrine based on short-term trends.

---

## Doctrine Review Checklist (for PRs)

A proposal is doctrine-aligned only if all answers are yes:

- Does this improve or protect operational leverage?
- Does this preserve Business-level durability?
- Does this keep autonomy and process co-existing?
- Does this preserve accountable delegation?
- Does this avoid doctrine drift for short-term gain?

---

## Canonical Terms

- **Business**: the durable operating subject that owns continuity.
- **Operator**: the human governor defining direction and boundaries.
- **Agent**: a replaceable worker executing scoped responsibilities.
- **Autonomy**: the ability to execute without constant prompting.
- **Process**: the shared operating backbone for durable execution.
- **Governance**: explicit boundaries for accountable control.
