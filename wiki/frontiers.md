# Active Frontiers

Track active PR frontiers here.

For each frontier include:

- PR id or slug
- current status
- current owner
- primary metric
- active quality gap
- next action

## PR-chat-surface-credibility

- current status: `final-signoff`
- current owner: `human-final-signoff`
- primary metric: component-level alignment, continuity, and chat-native usability defects trend toward zero across sidebar, header, message, composer, and thread captures
- active quality gap: no blocking component-level or exercised functional defect is currently visible; the remaining gap is human taste confirmation rather than another agent-found issue
- next action: request final signoff on the current chat surface, or, if new taste feedback appears, reopen `auto-ui` with that narrower gap

## PR-agent-runtime-resilience

- current status: `final-signoff`
- current owner: `human-final-signoff`
- primary metric: agent runtime resilience is a first-class contract rather than an implied behavior, and the live acceptance bar is a curated `30/30` suite with explicit catalog-owned coverage instead of a brittle title-matched verifier
- active quality gap: no blocking runtime or operational gap is currently visible inside the owned resilience boundary; the remaining gap is human final signoff rather than another agent-found issue
- next action: request final signoff on the bounded resilience frontier, or reopen only if review finds a concrete defect inside the committed boundary

## PR-agent-runtime-capability-ingress

- current status: `looping`
- current owner: `auto-project`
- primary metric: agent sessions expose managed capability surfaces for resources, retrieval, outcomes, runtime memory, and traces, and those surfaces are exercised by live soak coverage rather than inferred from prompt scaffolding
- active quality gap: the capability-ingress boundary is now isolated and narrow verification is green; the remaining gap is fresh live Codex soak evidence for this bounded set
- next action: rerun live Codex soak coverage on the bounded capability-ingress frontier, then decide whether it can move toward final-signoff

## PR-agent-runtime-code-scanning-hardening

- current status: `looping`
- current owner: `auto-project`
- primary metric: all currently open GitHub code-scanning alerts in the owned boundary close on the next CodeQL pass, without weakening runtime/session/sandbox behavior
- active quality gap: the second hardening pass is in branch state and the narrow local bar is green, but the frontier still lacks a fresh PR-diff CodeQL result proving alerts `#19-#22` are closed; the PR also carries a repo-wide docs markdownlint failure outside this frontier
- next action: push the second hardening pass, rerun GitHub CodeQL on PR `#11`, and compare the resulting PR-diff alert set against alerts `#19-#22`

## PR-chat-live-hydration

- current status: `looping`
- current owner: `auto-project`
- primary metric: the chat shell no longer depends on direct global demo imports for active conversation selection, transcript view construction, or thread-pane behavior because those concerns live in the shared shell runtime
- active quality gap: selection, thread close, and thread reopen now live below `App`, but the surface still relies on demo seed projections and does not yet hydrate from real chat state or live command dispatch
- next action: choose the next bounded hydration slice between real thread command flow and real composer/message dispatch

## PR-agent-runtime-heartbeat

- current status: `final-signoff`
- current owner: `human-final-signoff`
- primary metric: agent runtime can accept durable activations, execute them through an owner-aware scheduler/daemon ingress, persist private continuity files plus durable learnings, and requeue bounded follow-up work without depending on chat-specific context types
- active quality gap: no blocking gap is currently visible inside the Agent MVP boundary; the remaining work is a follow-on frontier around capability-aware context hydration and broader activation sources
- next action: request final signoff on the current Agent MVP, then open the next frontier for thin capability-pack seams and external trigger hydration

## PR-scalable-agent-runtime

- current status: `final-signoff`
- current owner: `human-final-signoff`
- primary metric: openboa agent architecture is re-framed around `agent definition + environment + session + attached resources + event stream`, making the runtime scalable without losing the OpenClaw-aligned `src/agents/` subsystem shape
- active quality gap: no blocking gap is currently visible inside the owned Agent boundary; the remaining work now belongs to follow-on frontiers around richer session resources, broader session event sources, and thinner capability-aware ingress above the session-first runtime
- next action: request final signoff on the session-first scalable Agent runtime, then open the next frontier for capability-aware session ingress and resource expansion
