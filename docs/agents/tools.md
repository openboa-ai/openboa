---
title: "Agent Tools"
summary: "Stable tool contract, ownership model, and permission policy semantics for the current Agent runtime."
---
# Agent Tools


`ToolDefinition` is the stable callable contract for Agent tools.

The current runtime treats tools as first-class runtime objects rather than prompt-only suggestions.

## What tools do not own

Not every Agent capability should become a tool.

Two important capabilities are only partially tool-shaped:

- `proactive`
  - mainly lives in the loop directive plus wake queue
- `learning`
  - mainly lives in the loop directive plus learn store

Tools support those loops, but they do not define them.

This matters because otherwise the runtime becomes a pile of ad hoc tool names instead of a coherent Agent model.

## Current shape

Each tool definition carries:

- `name`
- `description`
- `inputSchema`
- `outputSchema`
- `ownership`
- `permissionPolicy`
- `effects`
- `readOnly`
- `destructive`
- `interruptBehavior`

## Ownership

Current ownership values:

- `managed`
- `mcp`
- `custom`

Meaning:

- `managed`
  - runtime-owned capability
- `mcp`
  - capability exposed through MCP
- `custom`
  - capability that requires user-side or app-side fulfillment

This ownership split matters because not all tools are executed the same way.

## Permission policies

Current permission policies:

- `always_allow`
- `always_ask`

These follow the Anthropic naming directly.

They should be read as runtime policy, not UI phrasing.

Current managed `always_ask` frontier:

- `resources_promote_to_substrate`

That tool now pauses the session with `requires_action` until a matching `user.tool_confirmation` event arrives.
`permissions_check` is the preflight seam for that policy surface, so the model can inspect whether a named managed tool will require explicit confirmation before it calls it.
For shared mutation tools, `permissions_check` now also surfaces whether the tool is evaluator-gated through `outcome_evaluate`, plus the current evaluator verdict and the next recommended verification step when promotion is still unsafe.
If evaluator posture is staying `stable` or drifting `regressing`, that next step now prefers `outcome_history` before another broad shared mutation.
For shell mutation tools such as `shell_run` and `shell_exec`, `permissions_check` also now surfaces the current session shell mutation posture (`shellMutationPosture`) and the current bounded `outcomeEvaluation`, so shell preflight can see execution-hand posture and task posture on one surface.
If the caller includes a bounded `toolArgs` preview for `shell_run` or `shell_exec`, `permissions_check` can also project a conservative `readOnlyAlternative` when the planned command fits the low-risk `bash` hand.
In that shell posture, `nextStep` may therefore change to a read-first or recovery-first shell move such as `bash`, `shell_read_last_output`, `shell_describe`, or `shell_open`, while `nextOutcomeStep` still exposes the current evaluator-directed follow-up when an active outcome exists.
For shell mutation tools, `permissions_check` now also returns `shellReadFirstAlternatives`, a small bounded menu of safer exploratory moves such as `shell_describe`, `shell_read_last_output`, `bash pwd`, and `session_describe_context` when context pressure is already elevated.
When the planned shell command is clearly a direct file read, bounded file preview, directory listing, or plain workspace search, that same preflight can now push the next step all the way down to first-class built-ins such as `read`, `glob`, or `grep` instead of stopping at `bash`. That now also covers common `head -n` / `tail -n` previews, conservative `sed -n '10,20p'` style line-range previews, simple `wc -l <file>` line-count checks, `ls -la` / `ls -al` style listing variants, conservative `find <path> -name <pattern>` searches and current-cwd `find -name <pattern>` searches, and bounded `find <path> -type d|f -name <pattern>` searches by passing the optional `glob.kind` filter, plus conservative `grep -n` / `grep -i` / `grep -r` style search variants and bounded `rg -n` / `rg -i` search variants when the command still behaves like an ordinary inspection step. Query-only `grep`, `rg`, and `find -name` forms now fall back to the current session cwd instead of forcing a shell call just to search the current tree. Those `read` previews now report both `totalLineCount` and `selectedLineCount` so the model can decide whether another narrower reread is needed without guessing file size.
`permissions_describe` now provides the broad posture view:

- pending confirmation state
- a read-only shell alternative when the pending blocked shell request can safely run through `bash`
- all `always_ask` managed tools
- all evaluator-gated shared mutation tools
- the current session's bounded evaluator verdict
- the current session's `nextOutcomeStep` when evaluator-gated promotion is still unsafe
- the current session's `contextPressure` when the current assembled prompt is already dropping history or running low on headroom
- the current session's `shellMutationPosture` and `nextShellStep` when the live session shell is busy or missing
- the current session's `shellReadFirstAlternatives`, so shell preflight is not only prohibitive but also points at cheaper read-first seams

That same bounded decision surface is also materialized into `.openboa-runtime/permission-posture.json` and `.openboa-runtime/permission-posture.md`, so filesystem-first agents can reread current permission, evaluator, context-pressure, and shell recovery posture without depending on prompt-local summaries.

## Custom tools

Custom tools are special because they do not complete inside the same bounded harness run.

Instead:

1. the harness emits `agent.custom_tool_use`
2. the session pauses with `requires_action`
3. a later `user.custom_tool_result` event resumes the session

That keeps custom-tool pausing inside the session model rather than inventing a separate out-of-band workflow.

## Managed tool confirmation

Managed tools can now use the same `requires_action` pause seam.

Current flow:

1. a managed tool with `permissionPolicy: "always_ask"` is invoked
2. execution pauses before the tool side effect happens
3. the session stores a pending tool-confirmation request
4. the runtime emits a blocking `agent.tool_use`
5. `session.status_idle` records `blockingEventIds`
6. a later `user.tool_confirmation` event resumes the session

This keeps permission policy inside the session event model rather than hiding it in UI state.

If the user changes direction before the next wake, a `user.interrupt` event can clear the pending blocked state so the session is redirected instead of remaining pinned to the old confirmation request.

## Why proactive is not a tool family

There is no dedicated `proactive.*` tool family.

That is intentional.

Proactive continuation is currently expressed through:

- loop directive `queuedWakes`
- session wake queue
- orchestration consuming due wakes

The runtime keeps this outside the tool catalog because it is session-control behavior, not a callable side-effect surface.

If it were flattened into ordinary tools, the distinction between:

- "do work now"
- "schedule the next revisit"

would become harder to reason about.

## Managed navigation and recall tools

The current managed runtime exposes more than one kind of read surface.

Session navigation:

- `environment_describe`
- `agent_describe_setup`
- `agent_compare_setup`
- `vault_list`
- `permissions_describe`
- `permissions_check`
- `session_list`
- `session_list_children`
- `session_get_snapshot`
- `session_describe_context`
- `session_get_events`
- `session_get_trace`
- `session_search_traces`
- `outcome_read`
- `outcome_grade`
- `outcome_evaluate`
- `outcome_history`
- `outcome_define`

`environment_describe` now returns the environment fingerprint, the current session resource-contract fingerprint, the current agent-setup fingerprint, plus the materialized `environment.json` and `agent-setup.json` artifact paths, so the model can verify the exact execution contract it is standing on before it mutates or promotes anything.

`agent_describe_setup` is the setup-introspection seam.
It reads the materialized `agent-setup.json` and `agent-setup.md` contract for the current or another same-agent session, including the exact provider/model pairing, prompt-section fingerprints, bootstrap file fingerprints, managed tool catalog, skill catalog, environment contract, mounted resource contract, permission posture, and vault catalog that produced that session's runtime.

`agent_compare_setup` is the bounded setup-drift seam.
It compares the current session's materialized setup contract against another same-agent session and reports whether the two fingerprints match plus which setup sections changed, so cross-session reuse can stay explicit about setup compatibility before reopening prior work.

`session_get_trace` is now the canonical bounded reread seam for one wake.
By default it returns the full wake-scoped trace for the selected `wakeId`, including `span.started` and `span.completed` records for wake-level and tool-level execution, unless the caller explicitly narrows it with `types` or `limit`.

`session_get_snapshot` now also returns the materialized runtime artifact map for that session, the same `agentSetupFingerprint`, `setupMatchesCurrent`, the current evaluator posture (`outcomeTrend`, `nextOutcomeStep`), and a lifted `requiresAction` summary (`pendingActionKind`, `pendingActionToolName`) so the model can see whether the target session came from the same current setup, whether its latest outcome loop is actually improving, and whether it is already blocked on a bounded follow-up tool before reusing its work.
For the current session, that snapshot posture now uses the same live-shell-aware evaluator guard as `outcome_evaluate`, so a busy persistent shell forces `outcomeStatus="not_ready"` and points the next step at `shell_wait` instead of presenting stale promotion-safe posture.
That includes the current `.openboa-runtime` paths for context budget, outcome status/grade/evaluation, shell state/history/last-output, permissions, environment, tools, skills, vaults, traces, and event feed, so cross-session navigation can continue from a snapshot without guessing the next reread surface.
It also returns `relationToCurrent` and `childCount`, so multi-agent navigation can stay explicit about lineage and fanout instead of inferring it from raw metadata.
For navigation ergonomics, the snapshot summary also lifts `outcomeStatus` and `promotionReady` to the top level instead of forcing every caller to inspect the nested evaluator object first.

`session_list`, `session_list_children`, and `session_run_child` now include `agentSetupFingerprint` alongside `resourceContractFingerprint`, and they surface the latest evaluator posture (`outcomeTrend`, `promotionReady`, `nextOutcomeStep`) plus lifted `requiresAction` posture so the model can spot setup-compatible, still-improving, already-blocked sessions before opening a fuller snapshot.
When the current session itself is included in that list, its summary uses the same live-shell-aware evaluator guard, so navigation posture does not drift away from `permissions_check` or `outcome_evaluate` while a persistent shell command is still running.
The list tools also expose `setupMatchesCurrent` and `outcomeMatchesCurrent`, and they now accept bounded filters such as `hasOutcome`, `outcomeStatus`, `promotionReady`, `status`, and `activeMinutes`.
`session_list` also accepts `lineage=related|parent|children|siblings` and returns `relationToCurrent` plus `childCount`, so the model can stay inside the nearest parent/child/sibling cluster and see parent fanout before widening to all same-agent sessions.
It now also accepts `outcomeTrend=first_iteration|improving|stable|regressing`, and list ordering mildly prefers improving sessions over stalled or regressing ones when other signals are tied.
Its summaries also expose top-level `outcomeStatus` and `promotionReady`, so parent and sibling navigation can filter or sort on evaluator posture without extra nesting.
That lets a parent or same-agent session narrow navigation toward sessions that are already working on the same objective, already blocked on the same evaluator posture, or already promotion-safe before it opens a fuller snapshot.

`session_search_traces` is the wake-unit search seam.
It searches same-agent wake traces across sessions so the model can find one bounded prior execution run before calling `session_get_trace` to reread it in detail.
`session_search_context`, `session_search_traces`, `memory_search`, and `retrieval_search` now also accept a bounded `lineage` scope:

- `related`
- `parent`
- `children`
- `siblings`

That lets multi-agent or delegated same-agent work stay inside the most relevant parent/child/sibling session cluster instead of searching all same-agent history.

The current bounded multi-agent seam is:

- `session_delegate`
- `session_list_children`
- `session_run_child`

`session_delegate` creates a direct child session for the same agent and seeds it with a bounded task.
`session_run_child` then lets the parent advance that direct child for a few bounded cycles without collapsing both threads into one context window.
The delegated child summaries now also carry `relationToCurrent="child"`, top-level `outcomeStatus`, `promotionReady`, and `childCount`, so parent sessions can inspect child posture without digging through nested evaluator state.

Cross-session recall:

- `memory_list`
- `session_search_context`
- `retrieval_search`
- `memory_search`
- `memory_read`
- `memory_list_versions`
- `memory_read_version`
- `memory_write`
- `memory_promote_note`
- `learning_list`

## Learning-related tool surface

Learning is partly tool-shaped and partly harness-shaped.

The harness captures learnings from loop directives.
The managed tool surface then makes those learnings inspectable and promotable.

Today the most relevant learning-adjacent seams are:

- `learning_list`
  - inspect captured durable learnings
- `memory_search`
  - retrieve prior durable memory and learnings
- `memory_read`
  - reopen specific managed memory surfaces
- `memory_promote_note`
  - promote bounded durable notes into shared `MEMORY.md`

The important design rule is:

- learning capture happens in the harness
- learning inspection and promotion happen through tools

That split keeps improvement durable without pretending that every lesson should be an immediate tool side effect.

`memory_search` is now store-aware.
Instead of collapsing all prior session memory into one coarse checkpoint hit, it can return separate candidates for:

- shared `workspace_memory`
- managed `workspace_memory_notes`
- `session_checkpoint`
- `session_evaluation`
- `session_outcome`
- `session_state`
- `working_buffer`
- `shell_state`

Each hit carries a narrower expansion recommendation such as `agent_compare_setup`, `session_get_snapshot`, `outcome_evaluate`, `outcome_read`, or `memory_read(target=...)`.

When a matched prior session was produced by a different `agentSetupFingerprint`, retrieval now recommends `agent_compare_setup` before broader rereads like `session_get_events` or `session_get_trace`.
When the matched store is `shell_state` and a durable last command exists, the expansion recommendation now prefers `shell_read_last_output` before broader shell inspection.
When the current session has a materialized `agentSetupFingerprint`, memory hits from setup-compatible prior sessions receive a small deterministic ranking boost and report that setup affinity in the candidate metadata.
Retrieval candidates now also carry the matched session's bounded evaluator posture (`outcomeStatus`, `promotionReady`, `outcomeTrend`) so the model can tell whether a prior session is still improving, stalled, or already promotion-safe before it rereads anything broader.
If the caller passes `lineage`, that same store-aware recall can be limited to parent/child/sibling session neighborhoods before scoring.

`outcome_grade` is the first bounded evaluation seam.
It does not replace a future separate evaluator context, but it gives the runtime a deterministic rubric for whether a session is missing an outcome, blocked, sleeping, in progress, or a done candidate before the model decides the next bounded move.
That same grade is also materialized into `.openboa-runtime/outcome-grade.json`, `.openboa-runtime/outcome-grade.md`, and `.openboa-runtime/outcome-repair.md`, and the harness may surface a bounded `[outcome-repair]` runtime note when the grade implies that the next tool choice should be more explicit than free-form continuation.
When the blocked managed tool is a shell mutation request whose stored command is actually read-only, `outcome_grade` now prefers `bash` as the next bounded move instead of sending the model back through another confirmation-oriented preflight.

`outcome_evaluate` is the bounded promotion-safety seam.
It inspects the current durable outcome, recent wake trace, and idle result to decide whether shared promotion is actually safe yet.
For the current session, that bounded evaluator now also respects live persistent-shell posture: if a persistent shell command is still running, the evaluator is forced back to `not_ready` and its next suggested tool becomes `shell_wait` instead of allowing promotion-safe conclusions while the execution hand is still unsettled.
It now also reports a bounded evaluator `trend`:

- `first_iteration`
- `improving`
- `stable`
- `regressing`

plus a short `trendSummary`, so self-improvement loops can tell whether the latest bounded revision actually improved evaluator posture.
That evaluator verdict is materialized into `.openboa-runtime/outcome-evaluation.json` and `.openboa-runtime/outcome-evaluation.md`.
The same runtime now also keeps a bounded durable evaluation history, exposed through `outcome_history` and materialized into `.openboa-runtime/outcome-evaluations.json` and `.openboa-runtime/outcome-evaluations.md`.
Each record carries an `iteration`, the wake that produced it, the grade posture that led into it, and the evaluator verdict, so the agent can inspect evaluator drift across repeated bounded revisions instead of only reading the latest pass/fail posture.
When a durable outcome exists but the evaluator still says promotion is unsafe, the harness may also surface a `[promotion-gate]` runtime note so the model sees the current blocker before it tries to mutate shared memory or shared substrate.
If that evaluator posture stays `stable` or turns `regressing` across repeated bounded passes, the harness may also surface a bounded `[outcome-trend]` runtime note that points back to `outcome_history` before more mutation.

`session_describe_context` is the bounded context-introspection seam.
It exposes the current wake's assembled context budget, and it can also read the latest materialized context budget for another same-agent session.
That lets the model inspect prompt footprint, selected-vs-dropped history pressure, and top schema contributors without treating any single summary as truth.
When the current wake is obviously crowded, the harness may also inject a bounded `[context-pressure]` runtime note that points back to `session_describe_context` before the model keeps widening context blindly.
That same footprint is materialized into `.openboa-runtime/context-budget.json` and `.openboa-runtime/context-budget.md`.

`memory_write` is intentionally bounded.
Today it can:

- replace or append `session-state.md`
- replace or append `working-buffer.md`
- create an immutable version on each write
- enforce an optional `expectedVersionId` precondition for safe concurrent updates

`memory_promote_note` is the shared-memory writeback seam.
Today it can:

- append or replace the managed notes section inside shared `MEMORY.md`
- require explicit confirmation before mutating that shared agent-level memory surface
- create an immutable version on each promoted note write
- enforce an optional `expectedVersionId` precondition before shared note promotion
- require `outcome_evaluate` to report `status=pass` before mutating shared notes when a durable outcome exists, unless the caller explicitly overrides that gate

Neither tool rewrites the promoted runtime learnings section directly.

`memory_list_versions` and `memory_read_version` expose the audit trail for writable managed memory stores.
Today that includes:

- `session_state`
- `working_buffer`
- `workspace_memory_notes`

`memory_list` exposes the current attached managed memory-store contract.
Today that includes:

- `checkpoint`
- `shell_state`
- `session_state`
- `working_buffer`
- `workspace_memory`
- `workspace_memory_notes`

`retrieval_search` is intentionally backend-agnostic.
The current deterministic ranking policy also treats setup-compatible prior sessions as a mild prior, so same-agent history from the same agent setup rises before otherwise similar hits from older or drifted setups.
When the current session has an active durable outcome, deterministic retrieval also gives a mild boost to prior sessions that were working against the same outcome title or overlapping success criteria.
When sessions are in a parent/child/sibling relationship, deterministic retrieval also carries a mild relation prior and can be explicitly scoped by `lineage` so multi-agent work stays inside the nearest delegated cluster before widening to all same-agent history.
Automatic same-agent recall also mixes the current outcome grade and evaluator posture into its query cue, so blocked, sleeping, or promotion-unsafe sessions can rediscover more relevant prior repair loops before they widen context again.
When the current evaluator verdict is still promotion-unsafe, `retrieval_search` also biases its expansion plan toward bounded verification seams such as `outcome_read`, `outcome_evaluate`, `session_get_snapshot`, and `session_get_trace` before it recommends broader event rereads.
If the current evaluator trend is `stable` or `regressing`, that same expansion plan now prefers `outcome_history` before another broad reread so repeated churn is inspected explicitly.

Within the shell primitive, `shell_read_last_output` is the bounded reread seam for the most recent command result. It now also returns the current `busyPlan`, `recoveryPlan`, and `nextStep`, so a live-running or missing persistent shell can keep the next bounded move inside the shell primitive instead of forcing the model to switch surfaces just to decide what to do next.
It exposes the latest durable stdout/stderr summary plus the `.openboa-runtime/shell-last-output.*` artifact paths, without requiring the model to jump straight to broader shell history.
When the current session's persistent shell is still busy, it also returns a `liveCommand` block with the running command and partial stdout/stderr preview so read-first inspection does not fall back to stale last-command memory.
`shell_read_command` is the bounded reread seam for one specific recent command, and it now mirrors `busyPlan`, `recoveryPlan`, and `nextStep` so command-specific rereads still stay inside the shell primitive when the live shell is unresolved.
It uses a durable `commandId` from `shell_history` so the model can reopen an earlier shell step without depending on unstable list position or broad shell summaries.
Today the built-in deterministic backends are memory, session-context, and session-trace search.
The interface is also shaped so optional backends such as vector search can be added later without redefining the Agent core.

Procedural guidance:

- `skills_list`
- `skills_search`
- `skills_read`
- `shell_describe`
- `shell_history`
- `shell_wait`
  - wait briefly on the live persistent shell and return bounded running/completed status plus the same busy/recovery next-step posture when the shell is still unresolved
- `shell_read_command`
- `shell_set_cwd`
- `shell_set_env`
- `shell_unset_env`
- `shell_open`
- `shell_run`
- `shell_exec`
- `shell_close`

`session_describe_context` now also returns a bounded `pressure` summary derived from the current context budget. That summary exposes a `level`, a short list of `reasons`, and `recommendedTools` such as `retrieval_search`, `session_search_context`, `session_get_snapshot`, `session_get_trace`, or `shell_describe`, so the model can pivot toward narrower reread seams before it keeps widening prompt-local context.

`skills_list` and `skills_search` return concise metadata plus a small preview, and they now also carry a bounded `nextStep` that points at `skills_read(name)` so the model can move from discovery to full procedure read without inventing its own follow-up shape.
`skills_read` loads the full skill body only when the model has decided the skill is relevant.

Execution hand introspection:

- `read`
- `write`
- `edit`
- `glob`
- `grep`
- `bash`
- `sandbox_describe`
- `sandbox_execute`
- `resources_stage_from_substrate`
- `resources_list_versions`
- `resources_read_version`
- `resources_restore_version`
- `resources_compare_with_substrate`
- `resources_promote_to_substrate`

The first six are the preferred built-in tool surface for ordinary workspace work.
They map to the same bounded session hand as `sandbox_execute`, but they expose the common file and command loop directly instead of forcing the model to manually specify sandbox action names.

The runtime also mirrors the live managed tool and permission contract into the session hand itself under `/workspace/.openboa-runtime/managed-tools.json` and `/workspace/.openboa-runtime/permissions.json`.
That lets filesystem-first agents re-check the current tool surface and confirmation posture without depending only on prompt text.

Current local semantics:

- `read`
  - bounded text read from mounted resources
- `write`
  - overwrite or create a file under a writable mounted root
- `edit`
  - exact text replacement inside a writable file
- `glob`
  - glob-style file or directory matching under a mounted root
- `grep`
  - bounded text search under a mounted root
- `bash`
  - bounded read-only non-shell command execution rooted in a mounted path
- `shell_describe`
  - inspect the current durable shell state, mounted hand constraints, command policy, recent bounded commands, current context pressure, read-first shell alternatives, and the runtime artifact paths for shell rereads
- `shell_history`
  - reread the recent bounded shell history, including small stdout/stderr previews, live busy/recovery posture, and the latest shell-output artifact paths, before continuing shell-driven work
- `shell_wait`
  - wait briefly on the current session's live persistent shell command and return either bounded running status or the completed live result with the same shell artifact paths
  - when the command completes, it also syncs the durable shell-state and shell-last-output artifacts so later rereads do not depend on stale pre-completion memory
- `shell_read_command`
  - reread one specific recent shell command by durable `commandId`, including bounded stdout/stderr and the same shell artifact paths
- `shell_set_cwd`
  - update the durable session-scoped working directory for future bounded commands
- `shell_set_env`
  - persist one session-scoped shell environment variable for future `bash` and `shell_run` calls
- `shell_unset_env`
  - remove one session-scoped shell environment variable from the durable shell hand
- `shell_open`
  - open or reuse the current session's persistent shell process before multi-step shell work
- `shell_restart`
  - restart the current session's persistent shell process when `shell_describe` reports that the live shell is closed or stale
- `shell_run`
  - permission-gated one-shot writable shell execution inside the session execution hand
- `shell_exec`
  - permission-gated execution through the current session's persistent shell so cwd and exported env survive across steps
- `shell_close`
  - close the current session's persistent shell process when the multi-step shell loop is done

`bash` is intentionally the low-risk read-only command hand.
`shell_run` is the writable one-shot shell seam and requires explicit confirmation.
`shell_exec` is the writable persistent-shell seam and also requires explicit confirmation.
This is still not a persistent PTY-backed shell session, but together these tools now give the runtime:

- durable session-scoped cwd continuity
- durable session-scoped shell environment continuity
- optional durable session-scoped shell-process continuity
- recent command history with bounded output previews
- bounded read-only inspection
- permission-gated writable shell composition inside `/workspace`

`shell_describe` also prefers live sandbox introspection for the current session's persistent shell status, so it does not rely only on durable runtime memory when a shell process has already exited.
That live view now includes `busy` and `currentCommand`, so the model can see whether a long-running shell step is still active before it issues another shell mutation.
When the live shell is busy, `shell_describe` now also returns a `busyPlan` that explicitly recommends `shell_wait` before another shell mutation, but it also exposes an `evidencePlan` for `shell_read_last_output` plus an `allowlistedReadTools` list (`bash`, `read`, `glob`, `grep`, `session_get_snapshot`, `retrieval_search`, and the shell read/status tools) so the runtime can keep gathering bounded evidence without treating the busy shell as a full stop.
That busy plan also includes a small live stdout/stderr preview when the running command has already emitted output.
When the live shell is closed or missing, it now returns a `recoveryPlan` pointing at `shell_restart` or `shell_open` so the model can repair shell continuity without guessing.
Outside those busy/recovery cases, `shell_describe` now also returns the same bounded `contextPressure` summary and `shellReadFirstAlternatives` menu that the permission surface uses, except it omits the recursive `shell_describe` self-reference. That lets the shell primitive itself point at `bash`, `shell_read_last_output`, or `session_describe_context` without requiring a separate permission preflight.
Both `shell_describe`, `shell_history`, and `shell_read_command` now return the `.openboa-runtime/shell-state.json`, `shell-history.*`, and `shell-last-output.*` paths so the model can reread recent shell evidence from the filesystem instead of trusting only prompt-local summaries.

Current sandbox actions are filesystem-like within mounted resources:

- `list_dir`
- `read_text`
- `write_text`
- `append_text`
- `replace_text`
- `mkdir`
- `stat`
- `find_entries`
- `grep_text`
- `run_command`
- `run_shell`
- `inspect_persistent_shell`
- `open_persistent_shell`
- `exec_persistent_shell`
- `wait_persistent_shell`
- `close_persistent_shell`

This is intentionally bounded.
The Agent can work freely under mounted workspace paths, while unmounted or read-only paths stay protected by sandbox policy.

`sandbox_describe` is not just a friendly summary.
It returns the mounted resource map plus:

- `constraints`
- action-level access hints
- `commandPolicy`

The model should read that contract before using `sandbox_execute`, especially before `run_command`.

`resources_stage_from_substrate`, `resources_compare_with_substrate`, and `resources_promote_to_substrate` exist because the shared substrate mount is intentionally not writable through normal sandbox actions.
The model can stage a durable file into `/workspace`, compare it with the current substrate, revise it there, then explicitly promote the chosen result back into `/workspace/agent` through the managed tool surface.

Shared substrate writeback is now versioned.

- `resources_list_versions`
  - lists immutable versions for one promoted substrate path
- `resources_read_version`
  - rereads one immutable promoted substrate version by `versionId`
- `resources_restore_version`
  - restores one immutable substrate version back into the shared substrate as a new promoted version
  - can also enforce an optional `expectedVersionId` or `expectedContentHash` precondition before rollback writeback
  - now also defaults to the same `outcome_evaluate` gate when a durable outcome exists
- `resources_promote_to_substrate`
  - can enforce an optional `expectedVersionId` or `expectedContentHash` precondition before replacing shared substrate
  - now also defaults to the same `outcome_evaluate` gate when a durable outcome exists

`resources_compare_with_substrate` also returns the current content hashes and the latest recorded substrate version metadata.
That gives the model a safe optimistic contract: compare first, then pass the returned `latestVersionId` back as `expectedVersionId` when version history exists, or fall back to the returned `expectedContentHash` when the substrate file exists but has not been versioned yet.

The important rule is:

- search and summaries provide hints
- exact reread tools provide verification

`outcome_read` and `outcome_define` sit between those two layers.
They make the session's current success target durable without pretending that the outcome itself replaces the event log.
The outcome is meant to guide the bounded run, while the session log still records how the run actually evolved.

That is why `retrieval_search` should be read as candidate generation, not as canonical truth.

## What does not belong here

Tool definitions are not:

- session scheduling
- application-specific routing
- external publication semantics
- environment configuration

Those are separate seams.

## Related reading

- [Agent Runtime](../agent-runtime.md)
- [Agent Harness](./harness.md)
- [Agent Sandbox](./sandbox.md)
- [Agent Context](./context.md)
- [Agent Memory](./memory.md)
