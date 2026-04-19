# Claude Managed Agents Reverse Engineering

This page captures a source-first reverse engineering of Claude Managed Agents before applying the ideas to openboa.

Use it when:

- the current frontier is about making the `Agent` layer more scalable
- the team needs to understand Claude's managed-agent model as architecture, not just as API usage
- implementation choices risk overfitting to surface features without preserving the deeper contracts

This is a working synthesis, not yet a canonical `docs/` page.

## Conclusion

Claude Managed Agents is not primarily a "better prompt loop."

It is a **resource-oriented agent operating model** with explicit separation between:

- reusable **agent definition**
- reusable **environment definition**
- durable **session**
- attached **resources** such as files, memory stores, and vaults
- event-driven **execution**
- pluggable **hands** through built-in tools, MCP servers, and custom tools
- optional **outcome grading**
- optional **multi-agent session threads**

The most important architectural idea is:

- **the brain is not the same thing as the hands**

Anthropic's engineering write-up says their managed-agent service is built around interfaces that remain stable even as harnesses change, and explicitly frames the system as "decoupling the brain from the hands."  
Source: [Anthropic engineering: managed agents](https://www.anthropic.com/engineering/managed-agents)

That means the scalable unit is **not**:

- one provider-specific runner
- one container
- one prompt template

The scalable unit is:

- a durable **session state machine**
- operating over stable **resource attachments**
- calling stable **tool/hand interfaces**
- while the inference harness itself can be swapped, scaled, or upgraded independently

This is exactly the level that matters for openboa.

## Core resource model

### 1. Agent is a reusable, versioned configuration

Claude defines an agent as a reusable, versioned configuration that bundles:

- model
- system prompt
- tools
- MCP servers
- skills
- callable agents

Source: [Define your agent](https://platform.claude.com/docs/en/managed-agents/agent-setup)

This is a very important contract. It means the agent is **not** the running process. It is the **definition** that many sessions can reuse.

For openboa this implies:

- `AgentConfig` is not enough if it is treated as the whole runtime
- we need a stronger distinction between:
  - `agent definition`
  - `agent session`
  - `runtime execution`

### 2. Environment is a separate reusable resource

Claude separates the execution environment from the agent definition. An environment is created once and then referenced by many sessions, while each session still gets its own isolated container instance.  
Source: [Cloud environment setup](https://platform.claude.com/docs/en/managed-agents/environments)

This is another key contract:

- persona/capabilities belong to the agent
- execution substrate belongs to the environment
- a running session binds the two together

For openboa this implies:

- provider/runtime choice is not the same thing as environment shape
- workspace/container/sandbox config should likely become a first-class environment concept instead of being buried only inside agent config

### 3. Session is the canonical running object

Claude says a session is a running agent instance within an environment. Sessions reference an agent and an environment, maintain conversation history across multiple interactions, and act as a state machine whose execution is driven by events.  
Source: [Start a session](https://platform.claude.com/docs/en/managed-agents/sessions)

This is the single most important insight for openboa:

- **session is the runtime truth**

Not:

- prompt history only
- checkpoint file only
- queue entry only

Claude sessions also have explicit statuses:

- `idle`
- `running`
- `rescheduling`
- `terminated`

Source: [Start a session](https://platform.claude.com/docs/en/managed-agents/sessions)

For openboa this implies:

- `agent runtime` should be reorganized around a durable session lifecycle
- `activations`, `heartbeat`, and `scheduler state` should become session-facing execution mechanics, not the primary public model

## Event model

Claude Managed Agents is explicitly event-based:

- user events drive work
- session/agent/span events provide observability
- event type strings use a `{domain}.{action}` convention
- events can be queued and later processed

Source: [Session event stream](https://platform.claude.com/docs/en/managed-agents/events-and-streaming)

This matters because Claude is not primarily exposed as:

- `run(message) -> text`

It is exposed as:

- `send events`
- `observe session status`
- `resume after requires_action`
- `interrupt or redirect mid-flight`

This is a much better fit for scalable agent systems than direct request/response.

For openboa this implies:

- our current `activation queue` is directionally right
- but the public contract should shift toward a session event log and session state machine
- scheduler/daemon should become a consumer of session events, not feel like the top-level runtime API

## Brain vs hands

Anthropic's engineering article makes the key design claim:

- harnesses go stale as models improve
- managed agents should expose interfaces that stay stable as harnesses change
- decoupling the brain from the hands reduced time-to-first-token and made it easier to scale to many brains and many hands

Source: [Anthropic engineering: managed agents](https://www.anthropic.com/engineering/managed-agents)

The reverse-engineered architecture looks like this:

```text
agent definition
-> session
-> event log / state machine
-> inference harness ("brain")
-> hand interfaces (built-in tools, MCP, custom tools, containers, other agents)
```

The key point is that the hands are abstracted as tool interfaces. The harness does not need to know whether the execution target is:

- a cloud container
- an MCP server
- a custom app tool
- another agent

For openboa this implies:

- provider backends such as Claude, Codex, and OpenClaw-aligned local runners should be treated as **brains**
- sandboxes, MCP servers, repo workspaces, browsers, and later device targets should be treated as **hands**
- the stable seam should be the session/event/tool contract, not provider-specific loop glue

## Tools and permissions

Claude splits tools into three categories:

- built-in managed tools
- MCP tools
- custom tools executed by the application

Source: [Tools](https://platform.claude.com/docs/en/managed-agents/tools)

It also cleanly splits permissions:

- server-executed managed tools and MCP tools are governed by permission policies
- custom tools are executed by the application and are not governed by those policies

Source: [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies)

This is more precise than a single blanket "tool allow/deny" model.

For openboa this implies we should distinguish:

- runtime-owned tools
- external/MCP-owned tools
- app-owned callback tools

And permissioning should understand that distinction.

Today openboa has:

- `tools/`
- `sandbox/`
- `tool-policy.ts`

But the Claude model suggests we need a stricter split between:

- who executes the tool
- who confirms the tool
- who owns the side effect

## Skills

Claude's managed-agent docs and Agent Skills docs both reinforce the same skill contract:

- skills are reusable, filesystem-based resources
- they give domain-specific workflows, context, and best practices
- they load on demand
- only skill metadata is preloaded at startup
- `SKILL.md` is loaded only when relevant

Sources:

- [Managed Agents: Skills](https://platform.claude.com/docs/en/managed-agents/skills)
- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

This lines up strongly with OpenClaw and with the direction openboa already started taking.

For openboa this implies:

- stay filesystem-native for skills
- keep skill loading as progressive disclosure
- avoid turning skills into eagerly loaded prompt sludge

The most important Anthropic lesson here is:

- **skills are not just prompt fragments**
- they are a discovery + progressive disclosure system

## Resources: files, vaults, memory stores

Claude treats files, credentials, and memory as explicit session-attached resources.

### Files

- Files are uploaded separately
- then mounted into the session container through `resources[]`
- mounted copies are read-only
- the agent writes modified outputs to new paths in the container

Source: [Adding files](https://platform.claude.com/docs/en/managed-agents/files)

### Vaults

- vaults store per-user credentials
- sessions reference vaults by ID
- secrets stay out of reusable agent definitions

Source: [Authenticate with vaults](https://platform.claude.com/docs/en/managed-agents/vaults)

### Memory stores

- sessions are ephemeral by default
- memory stores carry learnings across sessions
- memory stores are attached via `resources[]`
- the agent automatically checks them at task start and writes durable learnings at task end
- stores are versioned/auditable and support explicit read/write/search/edit tools

Source: [Using agent memory](https://platform.claude.com/docs/en/managed-agents/memory)

This is a very strong design lesson for openboa:

- **persistent memory should not be just implicit prompt carryover**
- memory should be a first-class resource with auditability and attachment rules

openboa already has:

- workspace markdown substrate
- runtime `checkpoint.json`
- `session-state.md`
- `working-buffer.md`
- `learn/`

Claude's model suggests we should now tighten these into a more explicit resource model:

- session-local working state
- session-attached file resources
- reusable memory stores
- per-user/per-project/per-team durable learnings

## Outcomes

Claude outcomes explicitly "elevate a session from conversation to work" by attaching a target and grader loop to the session.  
Source: [Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes)

This is highly relevant to openboa's long-term `Work` layer.

The immediate lesson is:

- scalable agents should already be built so that a session can later carry:
  - a work target
  - a quality rubric
  - grader feedback

That means the scalable-agent frontier should not hard-code the runtime around "chatting" or "looping." It should already allow a future "session with outcome" contract.

## Multi-agent

Claude's multi-agent model is also resource-first:

- one coordinator agent can call configured callable agents
- all agents share the same container/filesystem
- each agent runs in its own session thread with isolated context/history
- threads are persistent
- called agents keep their own prior turns
- tools and context are not shared across agents

Source: [Multiagent sessions](https://platform.claude.com/docs/en/managed-agents/multi-agent)

This is a very sharp pattern.

It means scalable multi-agent is not:

- separate whole app process per agent by default

It is:

- shared execution environment
- isolated context threads
- explicit callable-agent registry
- coordinator-visible condensed primary thread

For openboa this implies:

- our future multi-agent runtime should likely be session-thread centric
- not a loose pile of independent daemons talking over ad hoc chat messages

## Reverse-engineered architecture

The Claude model can be summarized like this:

```text
AgentDefinition (versioned)
  = model + system + tools + skills + mcp_servers + callable_agents

Environment (versioned-ish reusable runtime substrate)
  = container/network/runtime config

Session (canonical running resource)
  = AgentDefinition x Environment x attached resources x event log x status machine

Resources attached to Session
  = files + vaults + memory stores + later other mounts

Execution
  = send user events
  = agent/session/span events stream back
  = tool confirmations and custom tool results re-enter as user events

Scale
  = many brains, many hands
  = brains can stay stateless
  = hands are just tool interfaces
```

This is the key architecture to carry into openboa.

## What this means for openboa

### Keep

Keep from current openboa:

- `src/agents/` as one subsystem
- OpenClaw-aligned workspace + skills + sandbox shape
- provider-agnostic runtime direction
- self-directed runtime pieces such as activation queue and scheduler

### Tighten

Tighten next:

1. **Session becomes the primary public runtime object**
   - current openboa still exposes activations too directly
   - scalable design should expose a durable agent session lifecycle

2. **Agent definition vs environment vs session**
   - these need to become distinct concepts
   - today they are still partially folded into agent config + runtime files

3. **Event-first runtime contract**
   - current `activate -> scheduler -> heartbeat` is good scaffolding
   - next step is to reframe it as session events and session status

4. **Explicit resource attachments**
   - files
   - vault/auth bundles
   - memory stores
   - perhaps repo mounts later

5. **Tool execution ownership**
   - runtime-executed tools
   - app-executed tools
   - MCP/server tools
   - each should have distinct permission semantics

6. **Future multi-agent thread model**
   - callable agent registry
   - persistent per-agent threads within a shared execution context

### Do not copy blindly

Do **not** copy from Claude Managed Agents:

- provider lock-in assumptions
- cloud-container-only assumptions
- one exact resource API shape

Instead copy:

- the separation of concerns
- the durable session contract
- the event/state-machine model
- the resource attachment model
- the brain/hands decoupling

## Claude / Codex / OpenClaw tightening

If we tighten openboa against all three reference systems, the roles become:

### Claude

Teaches us:

- scalable session/resource/event architecture
- brain vs hands separation
- durable multi-agent session threads

### OpenClaw

Teaches us:

- filesystem-native agent subsystem layout
- workspace bootstrap substrate
- progressive skill loading
- local agent operating ergonomics

### Codex

Teaches us:

- practical coding-agent execution quality
- real tool/sandbox ergonomics for coding tasks
- how the "brain" can be swapped while the runtime contract remains stable

So openboa should aim for:

- **Claude-informed resource/session architecture**
- **OpenClaw-aligned local filesystem-native subsystem**
- **Codex-grade coding-worker execution quality**

## Immediate implementation consequence for the next frontier

The next scalable-agent frontier should not start with more prompt engineering.

It should start with one architectural move:

- **promote session to the top-level runtime contract**

Concretely, that likely means:

1. define `AgentDefinition`, `AgentEnvironment`, `AgentSession`, and session-attached resources as explicit concepts
2. reframe current activation/heartbeat/scheduler flow as session-event processing
3. keep providers as brain backends behind that session contract
4. preserve OpenClaw-aligned `src/agents/` layout while making the resource model sharper

That is the right bridge from current openboa Agent MVP to a truly scalable agent layer.
