# Agent Runtime Self-Direction Contract

This page hardens how the openboa `Agent` runtime should become strongly self-directed
without learning `Chat`, `Work`, or `Observe` semantics.

Use it when:

- the repo risks building a timer-driven cron loop instead of a real self-directed runtime
- implementation needs a durable contract for scheduler, wake queue, and checkpoint behavior
- external inspiration such as Claude Code, OpenClaw, or Paperclip needs to be translated into openboa-specific runtime rules

This is a working synthesis, not yet the final canonical architecture page.

## Core thesis

openboa should not build a “chatbot with a timer.”

It should build a domain-agnostic worker runtime that:

- can be activated for many reasons
- can inspect its own prior runtime state
- can decide one bounded next move
- can execute that move
- can decide whether to sleep or schedule a follow-up
- can persist that decision as runtime truth

The strongest framing is:

`Agent` is a stateful worker engine, not a request-response wrapper around model calls.

## Strong inference from Claude Code primitives

There is no official public Anthropic document that explains any internal `Kairos` architecture.
So the statements below are inference, not confirmed implementation detail.

What is official and visible today:

- Claude Code has durable instruction and auto-memory layers that survive across sessions.
- Claude Code exposes lifecycle hooks such as `SessionStart`, `SessionEnd`, `Stop`, `SubagentStop`, `PreToolUse`, `PostToolUse`, and notification hooks.
- Claude Code supports deferred work and explicit session resume.
- Claude Code Remote Control keeps a local session running on your machine while other surfaces attach remotely.

Official sources:

- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code remote control](https://code.claude.com/docs/en/remote-control)

Strong inference from those primitives:

1. the main model loop likely remained turn-based
2. a separate supervisor or daemon likely coordinated when to resume or continue a session
3. memory and resume were likely treated as first-class runtime surfaces
4. hooks likely acted as event intake and control surfaces around the turn engine
5. “always-on” behavior likely came from orchestration around the session engine, not from making one model invocation magically persistent

For openboa this implies:

- do not overfit the core loop to a single synchronous `message -> response` path
- do not make “heartbeat” mean “run every N seconds”
- do not teach the agent core about room, approval, or task semantics
- do build a runtime supervisor around a durable agent loop

## What “human-like” should mean here

The goal is not fake personality.

The goal is runtime behavior that feels like a person working:

- something can interrupt or activate the worker
- the worker knows why it is active
- the worker remembers what it was doing
- the worker makes one bounded move
- the worker does not thrash forever
- the worker decides whether to continue later

So the human-like loop is:

1. become active for a reason
2. orient using checkpoint plus context
3. choose one bounded action
4. execute
5. reflect and persist
6. either sleep or schedule another bounded activation

## The most important naming correction

`wake` is intuitive but too vague if it becomes the only concept.

The cleaner split is:

- `ActivationIntent`
  - a durable request to run the agent once
- `origin`
  - the operational class of that intent
- `reason`
  - the open semantic reason string
- `Turn`
  - one actual runtime execution

Recommended shape:

```ts
type ActivationOrigin = "manual" | "external" | "self" | "scheduled"

type ActivationIntent = {
  id: string
  agentId: string
  origin: ActivationOrigin
  reason: string
  dueAt: string
  note?: string
  correlationId?: string
  dedupeKey?: string
  payload?: Record<string, unknown>
}
```

Why this is better:

- `origin` stays small and operational
- `reason` stays open and namespaced
- `Chat`, `Work`, and `Observe` can later add reasons without changing the core runtime taxonomy
- the scheduler can reason about due time, dedupe, and priority without understanding business semantics

## Correct runtime split

The agent runtime should be made of four distinct backend surfaces.

### 1. Activation intake

Owns:

- activation queue
- dedupe keys
- due time
- lease / claim
- enqueue / cancel / coalesce

Does not own:

- model execution
- chat semantics
- work semantics

### 2. Self-directed runtime core

Owns:

- loading config
- loading checkpoint
- assembling runtime context
- running one bounded turn
- parsing the loop directive
- deciding `sleep` versus `continue`
- emitting follow-up activation intents

Does not own:

- transport-specific triggering
- persistent shared business truth
- UI state

### 3. Execution substrate

Owns:

- provider adapters
- tool runtime
- auth
- sandbox
- workspace access

This is where one model/tool invocation actually happens.

### 4. Runtime memory

Owns:

- activation history
- checkpoint history
- session trace
- compact runtime summary
- follow-up counters and limits

This is private runtime truth, not shared company truth.

## The most important product rule

The scheduler should not be the intelligence.

The scheduler should only:

- know when an activation is due
- know whether it is already claimed
- know whether two activations can be coalesced
- know which agent should run

The runtime should be the intelligence.

The runtime should:

- interpret why it was activated
- inspect prior checkpoint state
- choose one bounded next move
- decide whether another activation should exist

That means:

- timer-only loops are wrong
- cron-style unconditional repetition is wrong
- repeated activation without a changing checkpoint is wrong

## Priority order of activations

For openboa, the long-term priority should be:

1. `external`
   - new event worth attention
2. `self`
   - the runtime explicitly asked for one bounded follow-up
3. `manual`
   - a human intentionally invoked the runtime
4. `scheduled`
   - low-frequency liveness or catch-up activation

So `scheduled` should be a fallback, not the main source of behavior.

## What should count as a follow-up

A follow-up should be rare and explicit.

It should mean:

- one bounded next inspection is justified
- not “keep working forever”
- not “retry blindly until success”

The runtime should impose hard guards:

- max consecutive follow-ups
- max same-correlation follow-ups
- no-op detection
- cool-down when repeated output is identical or nearly identical

## What openboa should implement next

The current runtime slice already has:

- heartbeat defaults in agent config
- a runtime-owned heartbeat store
- one manual heartbeat tick through the CLI
- bounded follow-up enforcement
- a shared generic LLM context type that no longer belongs to `Chat`

The next durable step should not be “run every 5 minutes.”

The next step should be:

### Step 1: Activation queue

Add a company-local queue for `ActivationIntent`.

Minimum needs:

- append
- list due
- claim with lease
- mark completed
- coalesce by `dedupeKey`

### Step 2: Scheduler daemon

Add one supervisor process that:

- polls due activations
- claims one
- calls the runtime once
- records the result

### Step 3: Runtime emits next activations

Replace `nextWakeAt` as a display-only field with actual queue writes.

This should split into two cases:

- `continue`
  - one bounded same-thread follow-up
- `queuedActivations`
  - one or more explicit future revisit requests emitted by the agent itself

So the runtime should not merely say “continue later.”
It should also be able to say:

- sleep now
- but enqueue these bounded revisit requests for later

### Step 4: Port boundary for Chat

Do not let `Chat` instantiate concrete agent runtime internals directly.

Instead introduce a thin runtime port such as:

```ts
interface AgentRuntimePort {
  activate(intent: ActivationIntent): Promise<AgentTurnResult>
}
```

Then `Chat` can ask for an activation without learning how the runtime works.

## Long-term relation to Chat, Work, Observe

The runtime core must stay domain-agnostic.

That means:

- `Chat` may create an activation with `reason = "chat.mention"`
- `Work` may create an activation with `reason = "work.assignment"`
- `Observe` may create an activation with `reason = "observe.policy-alert"`

But the runtime core should see only:

- an activation origin
- a namespaced reason string
- a payload
- a checkpoint
- a capability registry

This keeps the core generic while still letting higher layers make it useful.

## Canonical implementation direction

If openboa wants a “human-like” agent runtime, the correct direction is:

- not cron
- not a giant always-on monolith
- not domain-specific logic in the core

Instead:

- `ActivationIntent queue`
- `scheduler daemon`
- `self-directed runtime core`
- `private checkpoint memory`
- `capability packs` above the core

That is the most credible path to agents that feel self-directed without collapsing layer boundaries.
