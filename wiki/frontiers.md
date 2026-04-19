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

## PR-docs-public-boundary-ia

- current status: `looping`
- current owner: `auto-project`
- primary metric: public docs read as a coherent published surface with explicit Agent reading order and no internal authoring artifacts or internal links leaking into `docs/`
- active quality gap: the docs boundary and IA slice is isolated, but it still needs a bounded docs-only verification pass and a clean PR boundary separate from chat hydration or runtime code
- next action: verify the docs-only boundary with docs lint, linkcheck, Mintlify validate, and public-boundary enforcement, then open a standalone docs PR

## PR-chat-live-hydration

- current status: `looping`
- current owner: `auto-project`
- primary metric: the chat shell no longer depends on direct global demo imports for active conversation selection, transcript view construction, or thread-pane behavior because those concerns live in the shared shell runtime
- active quality gap: selection, thread close, and thread reopen now live below `App`, but the surface still relies on demo seed projections and does not yet hydrate from real chat state or live command dispatch
- next action: choose the next bounded hydration slice between real thread command flow and real composer/message dispatch

## PR-chat-surface-test-discovery

- current status: `looping`
- current owner: `auto-project`
- primary metric: chat surface regressions covered by existing `.test.tsx` files actually run in CI, and sidebar sections use distinct icons for followed threads and viewer recents instead of falling through to the generic default
- active quality gap: the current main branch ships the icons and the `.tsx` tests, but Vitest discovery only includes `.test.ts`, so a meaningful slice of chat UI regression coverage is silently skipped
- next action: isolate the Vitest discovery + section-icon fix into a standalone PR and verify the chat test bar on that branch

## PR-wiki-memory-hygiene

- current status: `final-signoff`
- current owner: `human-final-signoff`
- primary metric: internal wiki memory uses repo-root paths and neutral reference language rather than user-local absolute paths or language that overstates external borrowing
- active quality gap: no blocking gap is currently visible inside the owned wiki-memory boundary; the remaining step is review rather than another cleanup loop
- next action: request review on the bounded internal-memory cleanup PR, and reopen only if another path or wording defect is found inside the owned boundary

## PR-agent-internal-syntheses

- current status: `final-signoff`
- current owner: `human-final-signoff`
- primary metric: the missing internal agent syntheses for primitive-discipline and Claude gap analysis are captured in repo memory as standalone wiki pages instead of remaining untracked local notes
- active quality gap: no blocking quality gap is visible inside the bounded synthesis boundary; the remaining step is review rather than another implementation loop
- next action: request review on the bounded internal-syntheses PR, and reopen only if the synthesized guidance needs factual correction

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
