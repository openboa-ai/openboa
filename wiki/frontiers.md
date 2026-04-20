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

- current status: `final-signoff`
- current owner: `human-final-signoff`
- primary metric: all currently open GitHub code-scanning alerts in the owned boundary close on the next CodeQL pass, without weakening runtime/session/sandbox behavior
- active quality gap: the owned boundary is locally closed end-to-end; PR `#11` has zero open PR-diff CodeQL alerts, local `pnpm check` is green, and the docs gate now passes locally after replacing the broken Mintlify validate seam with repo-owned docs structure validation. The remaining gap is only the fresh GitHub rerun of the docs job on the updated branch state.
- next action: push the docs-validation follow-up, confirm GitHub docs CI is green on PR `#11`, then request final signoff on the bounded frontier

## PR-chat-live-hydration

- current status: `final-signoff`
- current owner: `human-final-signoff`
- primary metric: the chat shell no longer depends on direct global demo imports for active conversation selection, transcript view construction, or thread-pane behavior because those concerns live in the shared shell runtime
- active quality gap: no blocking gap is currently visible inside the owned chat-hydration boundary; remaining live Work/Observe truth now belongs to `PR-operational-shell-live-hydration` rather than another required slice here
- next action: request final signoff on the bounded chat-hydration frontier, then route `PR-operational-shell-live-hydration` to `auto-project` for the first read-only hydration slice

## PR-operational-shell-live-hydration

- current status: `looping`
- current owner: `auto-project`
- primary metric: the operational shell stops reading from fixed demo state and instead hydrates Work and Observe surfaces from a shared runtime-backed company state seam, with demo fallback preserved where no bridge exists
- active quality gap: `src/shell/web/company-shell-state.ts` still returns demo-backed operational state directly; no runtime gateway, snapshot aggregator, or refresh seam exists yet for Work and Observe
- next action: open the first bounded run around read-only operational-shell hydration through a shared gateway plus desktop bridge, then verify gateway-backed and fallback behavior in the existing app/work/observe tests

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
