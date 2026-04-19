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

The current shipping wedge is explicitly **chat-first** and the current default runtime surface is still **CLI-first**:
- agents work inside their own runtimes and workspaces
- the business is first experienced through shared chat rooms, DMs, and threads
- the human joins those same conversations directly
- the repo now also includes a browser host for the company shell, with desktop packaging following the same shell path
- `Work` and `Observe` remain core parts of the long-term product, and are already partially scaffolded in shared models
- `Work` and `Observe` are not yet shipped as primary UI surfaces
- control plane remains secondary and should never replace Chat, Work, or Observe

Primary operating and architecture docs:
- [`docs/harness.md`](./docs/harness.md)
- [`docs/PRODUCT.md`](./docs/PRODUCT.md)
- [`docs/DESIGN.md`](./docs/DESIGN.md)
- [`docs/QUALITY.md`](./docs/QUALITY.md)
- [`docs/development.md`](./docs/development.md)
- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/chat.md`](./docs/chat.md)

Documentation layers:

- [`docs/`](./docs/index.md)
  - public, canonical documentation
- [`wiki/`](./wiki/index.md)
  - internal syntheses, PR memory, and run memory
- [`raw/`](./raw/)
  - raw imported source material and immutable evidence

The current narrowest wedge is:
- founder-operators and very small AI-native teams
- already coordinating work across multiple agents/tools
- wanting one company chat surface with approvals and execution visibility

## North Star vs. First Shipping Wedge

The product thesis stays the same:

- openboa is an **AI-native company operating system**
- the business is the durable operating subject
- agents are the workforce

But the first shippable wedge is intentionally smaller:

- **MVP-1: Credible Multi-Agent Company Chat**
- one believable company chat surface where humans, local openboa agents, and ACP-attached agents can all participate
- familiar team-chat grammar for channels, DMs, group DMs, threads, mentions, unread, and search
- provider-backed runtime seams for local agent execution and ACP as the external participation seam

This is not a retreat from the operating-system thesis.
It is the correct first organ of the operating system to make real.

If the chat layer is not believable, `Work`, `Observe`, and governance will feel pasted on.
If the chat layer is believable, those layers can be added on top as intentional publication, execution visibility, and policy.

For MVP-1, the explicit non-goals are:

- a first-class `Work` board
- a first-class `Observe` product surface
- TUI as a primary interface
- mobile shell translation
- deep approval and control-plane UX

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

## CLI

You can install the CLI from the source tree and run `openboa` directly:

```bash
npm install -g .
openboa setup
openboa agent spawn --name pi-agent
openboa agent chat --name pi-agent --message "Summarize the current company state."
```

For repo-local development, `pnpm openboa ...` still works, but the installed CLI is the primary path.

The single-agent runtime now follows a provider/runtime split between:
- provider capabilities (`openai-codex`, `claude-cli`)
- runner kind (`embedded`, `cli`)
- provider session reuse
- explicit tool / sandbox / skills policy surfaced in the runtime environment prompt

Setup now also defines the company default provider and auth plan:

```bash
openboa setup --default-provider openai-codex --auth codex
openboa setup --default-provider claude-cli --auth claude-cli
openboa setup --default-provider claude-cli --auth both
```

Later, `agent spawn` follows that company default unless you override it with `--provider`.

Example providers:

```bash
openboa agent spawn --name codex-agent --provider openai-codex
openboa agent chat --name codex-agent --message "Summarize the current company state."

openboa agent spawn --name claude-agent --provider claude-cli
openboa agent chat --name claude-agent --message "Summarize the current company state."
```

For Claude-backed agents, ensure the `claude` CLI is already installed and authenticated in your shell.

You can also run provider auth flows directly:

```bash
openboa auth login
openboa auth login --provider default
openboa auth login --provider codex
openboa auth login --provider claude-code
openboa auth login --provider both
openboa auth status
```

`openboa auth login` follows the company default provider from `openboa setup`, so `setup`, `auth login`, and `agent spawn` all share the same default unless you explicitly override it.

## Company UX

The target user-facing surface is eventually the company app:

- top header tabs: `Chat | Work | Observe`
- `Chat`: Inbox-first sidebar, channels, grouped DMs, live transcript, simple composer
- `Work`: global board-first work hub with queue/filter sidebar and unified work cards
- `Observe`: work-first execution surface with active queues and linked chat context

The intended mental model is a familiar company chat client with a separate Work surface:

- humans and agents are both participants in the same chat system
- Chat and Work are both long-term main surfaces
- agent work happens in private workspaces and is inspectable on demand
- control plane is layered on top as a secondary governance surface

Today, the contributor-default runtime surface is still CLI-first, but the repo now also ships:

- a browser host for the company shell under `src/shell/web/`
- a first macOS desktop packaging path for that same shell

Current harness state lives in:

- [`wiki/frontiers.md`](./wiki/frontiers.md)
- [`wiki/prs/`](./wiki/prs/)
- [`wiki/runs/`](./wiki/runs/)

This is intentionally not a dashboard-first product. The company speaks in Chat, tracks work in Work, and verifies execution in Observe.

The current minimum working loop is:
- every agent has a private workspace journal under `.openboa/agents/<agent-id>/workspace`
- humans can talk to agents through shared rooms and DMs
- agents can talk to other agents through the same chat system
- the sidecar summarizes status without replacing chat as the main product surface

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

### Minimal Single-Agent Runtime
A minimal local-first single-agent runtime path is now available for development and acceptance testing.

Run:

```bash
pnpm dev -- "hello pi runtime"
```

This executes one turn and persists:
- shared company truth at `.openboa/runtime/company-ledger.jsonl`
- session metadata/checkpoints at `.openboa/agents/<agentId>/sessions/<sessionId>.jsonl`
- private agent execution evidence at `.openboa/agents/<agentId>/workspace/journal.jsonl`

You can also choose the provider explicitly:

```bash
openboa agent spawn --name codex-agent --provider codex
openboa agent spawn --name claude-agent --provider claude-code
openboa agent list
```

### Contributing (WIP)
Contributions are welcome, especially around:
- design discussions for core primitives
- skills as reusable operational playbooks
- governance boundaries, auditability, and observability
- documentation quality and conceptual clarity

### License
MIT License. Copyright (c) 2026 openboa.
