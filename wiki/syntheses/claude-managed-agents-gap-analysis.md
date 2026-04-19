---
title: "Claude Managed Agents Gap Analysis"
summary: "Source-derived contracts from Anthropic's Managed Agents docs, mapped to the current openboa Agent layer."
---

This synthesis tracks the working comparison between Claude Managed Agents and the current openboa Agent runtime.

It is intentionally internal because it is:

- source-analysis material
- frontier-tracking material
- implementation-gap reasoning rather than public product explanation

The public docs should explain the openboa Agent on its own terms.
This note exists to guide internal runtime evolution.

Primary sources:

- [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup)
- [Tools](https://platform.claude.com/docs/en/managed-agents/tools)
- [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies)
- [Environments](https://platform.claude.com/docs/en/managed-agents/environments)
- [Cloud containers](https://platform.claude.com/docs/en/managed-agents/cloud-containers)
- [Sessions](https://platform.claude.com/docs/en/managed-agents/sessions)
- [Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming)
- [Define outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes)
- [Vaults](https://platform.claude.com/docs/en/managed-agents/vaults)
- [Memory](https://platform.claude.com/docs/en/managed-agents/memory)
- [Multi-agent](https://platform.claude.com/docs/en/managed-agents/multi-agent)
- [Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Skill best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Claude Platform release notes overview](https://platform.claude.com/docs/en/release-notes/overview)

Freshness checkpoint:

- Claude Managed Agents entered public beta on April 8, 2026, behind the `managed-agents-2026-04-01` beta header per the official release notes.
