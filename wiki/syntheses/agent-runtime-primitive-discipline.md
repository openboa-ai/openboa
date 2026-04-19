# Agent Runtime Primitive Discipline

This page records the internal decision rule for adding or refusing new Agent-runtime primitives.

Use it when:

- an Agent PR proposes a new runtime concept
- a capability might fit inside `session`, `tools`, `sandbox`, `environment`, `resources`, `memory`, `skills`, `outcome`, or bootstrap/system guidance
- the team needs to decide whether something is a real openboa primitive or just a bounded implementation inside an existing seam

This is an internal synthesis.
It should not be promoted into deploy-facing docs.

## Why this exists

Managed-agent structure is converging.

Across Anthropic Managed Agents, OpenAI Codex, and OpenClaw-aligned agent systems, the recurring seams are already recognizable:

- durable `session`
- execution `environment`
- attached `resources`
- `tools`
- `sandbox` or shell hands
- `memory`
- `skills`
- `outcome`
- runtime/system guidance

That means openboa should not create a new top-level runtime primitive just because a capability sounds important.
If a capability fits inside an existing seam, adding a new noun only makes the runtime harder to understand.

The default should therefore be conservative:

- prefer existing managed-agent seams first
- widen those seams only when necessary
- add a new primitive only when the runtime becomes simpler or more truthful because of it

## Acceptance rule

Treat a proposed Agent capability as existing-seam work unless it fails this test.

Only add a genuinely new primitive when all of the following are true:

1. the capability cannot be modeled cleanly inside existing seams such as `session`, `tools`, `sandbox`, `environment`, `resources`, `memory`, `skills`, `outcome`, or runtime/system guidance
2. several independent features need the same abstraction
3. the new abstraction makes the runtime contract simpler or clearer instead of widening it
4. the abstraction expresses openboa's thesis rather than a local implementation shortcut

If any of those fail, do not add the primitive.
Model the capability inside an existing seam instead.

## Default mapping

When a new capability appears, try these buckets first.

- `session`
  - durable truth
  - event log
  - checkpoints
  - navigation, reread, trace search, child-session lineage
- `tools`
  - user-visible callable capability
  - introspection surfaces
  - permission preflight
  - staged writeback helpers
- `sandbox`
  - filesystem hand
  - shell hand
  - bounded execution
  - mount-aware read/write policy
- `environment`
  - execution posture
  - mounted resource topology
  - vault availability
  - command policy
- `resources`
  - stage/compare/promote
  - substrate versioning
  - session workspace hand
  - vault-backed mounts
- `memory`
  - session state
  - working buffer
  - shell state
  - shared notes
  - promoted durable notes
  - retrieval stores
- `skills`
  - reusable procedures
  - discoverable operating playbooks
  - progressive disclosure knowledge
- `outcome`
  - user-defined success criteria
  - grading
  - repair loop
  - evaluation gate
- runtime/system guidance
  - prompting rules
  - self-direction hints
  - loop protocol

## Quick tests

Use these tests before creating a new primitive.

### Test 1: Is it just a bounded tool?

If the behavior is "the agent should be able to call X" or "the model should inspect Y before doing X", it is usually a tool.

Examples:

- `permissions.check`
- `session.search_traces`
- `resources.promote_to_substrate`
- `shell.restart`

These are not new primitives.
They are managed tools inside existing seams.

### Test 2: Is it just another memory target or runtime artifact?

If the capability is "keep track of this state" or "materialize this runtime view", it is usually memory or a runtime artifact.

Examples:

- `session-runtime.md`
- `outcome-grade.md`
- shell history
- workspace notes

These are not new primitives.
They belong inside memory/runtime materialization.

### Test 3: Is it just policy on an existing hand?

If the capability changes how a shell, file mount, or substrate write behaves, it is usually sandbox/resource/environment policy.

Examples:

- vault read restrictions
- read-only substrate mounts
- write leases
- shell confirmation rules

These are not new primitives.

### Test 4: Is it just better prompt/runtime steering?

If the capability is guidance about how the model should use existing surfaces, it belongs in system guidance or loop protocol.

Examples:

- use `permissions.check` before risky tools
- use `session.get_events(...aroundEventId...)` to verify a retrieval hint
- prefer `skills.read` after `skills.search`

These are not new primitives.

## When a new primitive might actually be warranted

A new primitive is only justified when the capability is both cross-cutting and thesis-level.

Candidate examples:

- a company-owned truth seam that cannot be reduced to Agent-local session/memory/resource state
- a governance primitive that spans `Agent`, `Chat`, `Work`, and `Observe` and cannot be represented as tools, events, or resources
- a business-owned execution artifact class that must exist independently of any one session, memory store, or runtime tool

Even then, the burden is high.
The proposal should first explain why the capability cannot be expressed as:

- a session event family
- a managed tool family
- an attached resource
- a memory store
- an outcome/evaluation contract
- an environment or sandbox policy

## Current rule for the scalable-agent frontier

Inside the current Agent-runtime PR frontier:

- default to existing managed-agent seams
- do not create new top-level nouns casually
- treat openboa-specific primitives as the last resort
- if a new primitive is proposed, write the rejection case against all existing seams first

This keeps the Agent layer aligned with the emerging standard managed-agent shape while preserving room for openboa-specific thesis where it truly matters.
