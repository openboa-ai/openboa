# RUN-20260409-1743-claude-managed-agents-source-reading

- `PR`: `PR-scalable-agent-runtime`
- `Worker`: `auto-project`
- `Status`: `kept`

## Goal

Read Claude Managed Agents official docs and engineering material closely enough to recover the real architectural contracts before designing the next scalable-agent slice for openboa.

## Sources read

- [Claude Managed Agents blog](https://claude.com/blog/claude-managed-agents)
- [Managed agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Anthropic engineering: managed agents](https://www.anthropic.com/engineering/managed-agents)
- [Managed agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)
- [Prototype in Console](https://platform.claude.com/docs/en/managed-agents/onboarding)
- [Define your agent](https://platform.claude.com/docs/en/managed-agents/agent-setup)
- [Tools](https://platform.claude.com/docs/en/managed-agents/tools)
- [MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector)
- [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies)
- [Skills](https://platform.claude.com/docs/en/managed-agents/skills)
- [Cloud environment setup](https://platform.claude.com/docs/en/managed-agents/environments)
- [Container reference](https://platform.claude.com/docs/en/managed-agents/cloud-containers)
- [Start a session](https://platform.claude.com/docs/en/managed-agents/sessions)
- [Session event stream](https://platform.claude.com/docs/en/managed-agents/events-and-streaming)
- [Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes)
- [Authenticate with vaults](https://platform.claude.com/docs/en/managed-agents/vaults)
- [Accessing GitHub](https://platform.claude.com/docs/en/managed-agents/github)
- [Adding files](https://platform.claude.com/docs/en/managed-agents/files)
- [Using agent memory](https://platform.claude.com/docs/en/managed-agents/memory)
- [Multiagent sessions](https://platform.claude.com/docs/en/managed-agents/multi-agent)
- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Remote MCP servers](https://platform.claude.com/docs/en/agents-and-tools/remote-mcp-servers)

## What was learned

- Claude Managed Agents is fundamentally a resource-oriented runtime, not just an improved harness loop.
- The core objects are `agent`, `environment`, `session`, session resources, and the event stream.
- Session is the durable state machine. Events drive work.
- The most important architectural idea is the separation between the inference brain and the execution hands.
- Skills, files, vaults, and memory stores all behave as attachable resources rather than hidden prompt hacks.
- Multi-agent scale is modeled as persistent session threads sharing an environment but isolating context.

## Artifact

- Added [claude-managed-agents-synthesis.md](../syntheses/claude-managed-agents-synthesis.md)
- Opened [PR-scalable-agent-runtime.md](../prs/PR-scalable-agent-runtime.md)

## Keep / discard decision

- `Kept`
- Reason: the analysis sharply changed the next implementation target. The next scalable-agent slice should promote session to the primary runtime contract rather than merely extending the current activation-centric shape.
