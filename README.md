<p align="center">
  <img src="https://github.com/user-attachments/assets/e0d06eca-7d55-42a7-9fe9-b87cff7be8b9" alt="openboa logo" width="220" />
</p>

<h1 align="center">🐍 openboa</h1>
<p align="center"><strong>Business of Agents (BOA)</strong> — Model: Business as Agent.</p>
<p align="center">Anyone can own a business. Anyone can run one.</p>

<p align="center">
  <img src="https://img.shields.io/badge/stage-early--design--first-orange" alt="Stage: Early design-first" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License" /></a>
</p>

openboa is an open-source runtime for building a **Business of Agents (BOA)** through the *Business as Agent* model: a durable business entity that runs through autonomous agents while remaining accountable to a human operator.
A boa does not depend on a fixed list of agents. It can identify what the business needs next, create or reshape specialized agents for that need, and coordinate them as one operating system.
Instead of treating agents as the product, openboa treats the business itself as the product, with governance, shared memory, and continuity built in from day one.

## Table of Contents
- [Vision](#vision)
- [Model](#model)
- [BOA-0 Core Doctrine](#boa-0-core-doctrine)
- [Operating Model (WIP)](#operating-model-wip)
- [Project](#project)

## Vision

### Why openboa exists
Ideas are abundant. Sustained execution is not.

Running a business requires constant coordination: decisions, delegation, communication, follow-ups, context management, and risk control.

Most people do not fail because they lack intelligence. They fail because they lack leverage and operational continuity.

openboa exists to change that.

### What a boa gives you

#### Autonomy unlocks time
The business keeps moving without constant prompting. Routine work is handled. Plans are drafted. Context is maintained. The operator focuses on direction, not chores.
When new responsibilities appear, the boa can form role-focused agents and delegate work without waiting for manual restructuring.

#### Interaction unlocks leverage
A business of agents can specialize, parallelize, and coordinate. Work no longer depends on one overloaded mind. Interaction creates movement larger than any single agent can sustain alone.
In openboa, interaction is structured so newly formed agents inherit context, protocols, and handoff rules from the business.

#### Governance unlocks confidence
Delegation only works when it is safe. Policy, approvals, isolation, audit, and observability ensure that autonomy never removes control. You can delegate without losing sleep.
Every newly created agent operates inside the same governance boundary from its first task.

### What success looks like
A person boots a boa. They speak to their secretary agent. The business begins moving.

Agents collaborate. Skills structure execution. Governance maintains confidence.

Anyone can own a business. Anyone can run one.

## Model

### Business as Agent
Business as Agent is a design stance.

The business is the durable entity. Agents are the workforce.

The business holds:
- identity
- goals
- shared memory
- governance rules
- audit history

Agents:
- operate independently
- collaborate
- specialize
- evolve over time without breaking the business itself

A boa persists. Agents evolve.

### Multi-agent formation is the core
The core behavior of a boa is not just running multiple agents. It is dynamically forming the right agent team for the current business state.

As goals and workload change, a boa can create new specialized agents, reassign responsibilities, and retire or reshape agents that are no longer useful.

This is how the business stays durable while the workforce keeps evolving.

Core concept interfaces in this runtime model:
- `boa`: durable business runtime unit
- `Operator`: human governor
- `Agent`: evolvable worker entity
- `Skill`: reusable operational playbook
- `Protocol`: structured coordination acts
- `Governance Boundary`: approval, policy, and isolation limits
- `Audit Trail`: accountable execution history

### Skills make businesses operable
Tools provide capability. **Skills provide repeatable operation.**

In openboa, Skills are operational playbooks:
- how to triage
- how to report
- how to negotiate
- how to onboard
- how to execute consistently

Skills turn instinct into system. They allow boas to grow without losing coherence.

Skills are composable, shareable, and open-source.

### Conversation and Protocol
Organizations need both freedom and structure.

Conversation supports creativity, alignment, culture, and negotiation. Protocol supports propose, assign, report, request approval, and escalate.

No single philosophy is forced. The operator decides how formal the business should be.

## BOA-0 Core Doctrine

The BOA-0 doctrine defines the baseline for strategic and product decisions:
- Core State
- Core Values
- Core Philosophy
- Philosophy -> Spec (System Contracts)
- Sharp Non-goals

Read:
- [`DOCTRINE.md`](./DOCTRINE.md)
- Docs: [Core Doctrine](./docs/concepts/core-doctrine.md), [System Contracts](./docs/concepts/system-contracts.md), [Sharp Non-goals](./docs/help/non-goals.md)

## Operating Model (WIP)

### Autonomy by default. Control at any time.
openboa maximizes autonomy because autonomy creates productivity.

But human control is always possible through:
- enforceable policy
- approval boundaries
- execution isolation
- audit trails
- full observability

Trust is not assumed. It is engineered.

### Dynamic Agent Lifecycle (WIP)
`Detect Need -> Define Role -> Create Agent -> Assign Skill Contracts -> Coordinate -> Evaluate -> Evolve or Retire`

Agents are created to satisfy business needs, not to maximize agent count. Lifecycle decisions stay governable through policy, approval boundaries, and audit trails.

### Key Primitives (WIP)
- `Business Identity`: canonical identity and continuity of the business.
- `Goal Set`: explicit objectives the business should pursue and prioritize.
- `Shared Memory`: persistent operational context across agents and time.
- `Agent Role`: scoped responsibilities and authority per agent.
- `Skill Contract`: reusable operational procedure with expected inputs and outcomes.
- `Protocol Action`: structured interaction unit for coordination and accountability.
- `Governance Policy`: enforceable rules for approvals, safety, and control boundaries.

### Execution Loop (WIP)
`Observe -> Plan -> Assign -> Execute -> Report -> Review`

This loop defines a minimal operating cadence for coordinated agent work under human governance.

### Non-goals (Current Stage)
- not a fully autonomous no-operator system
- not a generic chatbot framework
- not production-scale orchestration yet

## Project

### Status
Early stage. Design-first. Defining primitives before scaling implementation.

### Near-term Focus (WIP)
- define minimal primitive schema
- specify operator approval boundaries
- define skill packaging conventions
- establish observability and audit baseline

### Getting Started (WIP)
- Runtime and bootstrap documentation are coming soon.
- Initial primitives are currently under definition.
- A runnable stack and CLI are not published yet.
- Until then, use repository Issues and Discussions as temporary collaboration channels.

### Contributing (WIP)
Contributions are welcome, especially around:
- design discussions for core primitives
- skills as reusable operational playbooks
- governance boundaries, auditability, and observability
- documentation quality and conceptual clarity

### License
MIT License. Copyright (c) 2026 openboa.
