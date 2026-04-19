---
title: "openboa Docs"
summary: "Documentation for openboa. Start here to orient around the project and then drill into the Agent runtime, product surfaces, and build canon."
---
# openboa Docs


openboa docs are organized by durable surfaces and supporting canon.

The most important distinction is:

- `Agents`
  - the reusable worker runtime
- everything else
  - products, build guidance, or support material built around or alongside that runtime

If you are trying to understand the runtime itself, start with the Agents tab.

## Surface map

<CardGroup cols={2}>
  <Card title="Agents" href="/agents">
    Start with the Agent Hub, then drill into meaning, capabilities, runtime, workspace, memory, context, bootstrap, architecture, and references.
  </Card>
  <Card title="Chat" href="/chat">
    The current chat-first product surface built above the shared system.
  </Card>
  <Card title="Work" href="/work">
    The planned execution and assetization layer above the runtime.
  </Card>
  <Card title="Observe" href="/observe">
    Governance and evidence surface for explaining execution.
  </Card>
</CardGroup>

## If you are here for the Agent runtime

Read these in order:

1. [Agent Hub](./agents/index.md)
2. [Agent](./agent.md)
3. [Agent Capabilities](./agents/capabilities.md)
4. [Agent Runtime](./agent-runtime.md)
5. [Agent Workspace](./agents/workspace.md)
6. [Agent Memory](./agents/memory.md)
7. [Agent Context](./agents/context.md)
8. [Agent Bootstrap](./agents/bootstrap.md)
9. [Agent Architecture](./agents/architecture.md)

Then use the reference pages:

- [Agent Sessions](./agents/sessions.md)
- [Agent Environments](./agents/environments.md)
- [Agent Resources](./agents/resources.md)
- [Agent Harness](./agents/harness.md)
- [Agent Sandbox](./agents/sandbox.md)
- [Agent Tools](./agents/tools.md)

## Other reading paths

<Steps>
  <Step title="If you are new to openboa">
    Read [Introduction](./introduction.md), [Business of Agents](./concepts/business-of-agents.md), and [Architecture](./architecture.md).
  </Step>
  <Step title="If you want product context">
    Read [Chat](./chat.md), [Work](./work.md), and [Observe](./observe.md).
  </Step>
  <Step title="If you want to contribute safely">
    Read [Quickstart](./quickstart.md), [Development](./development.md), [Project Harness](./harness.md), [Product Canon](./PRODUCT.md), [Design Canon](./DESIGN.md), and [Quality Canon](./QUALITY.md).
  </Step>
</Steps>

## What lives where

<Tabs>
  <Tab title="Agents">
    - [Agent Hub](./agents/index.md)
    - [Agent](./agent.md)
    - [Agent Capabilities](./agents/capabilities.md)
    - [Agent Runtime](./agent-runtime.md)
    - [Agent Workspace](./agents/workspace.md)
    - [Agent Memory](./agents/memory.md)
    - [Agent Context](./agents/context.md)
    - [Agent Bootstrap](./agents/bootstrap.md)
    - [Agent Architecture](./agents/architecture.md)
    - [Agent Sessions](./agents/sessions.md)
    - [Agent Environments](./agents/environments.md)
    - [Agent Resources](./agents/resources.md)
    - [Agent Harness](./agents/harness.md)
    - [Agent Sandbox](./agents/sandbox.md)
    - [Agent Tools](./agents/tools.md)
  </Tab>
  <Tab title="Overview">
    - [Introduction](./introduction.md)
    - [Acknowledgements](./acknowledgements.md)
    - [Architecture](./architecture.md)
    - [Business of Agents](./concepts/business-of-agents.md)
    - [Core Doctrine](./concepts/core-doctrine.md)
    - [System Contracts](./concepts/system-contracts.md)
    - [Sharp Non-goals](./help/non-goals.md)
    - [Network](./network.md)
  </Tab>
  <Tab title="Build">
    - [Quickstart](./quickstart.md)
    - [Development](./development.md)
    - [Contribution Guide](./contribution-guide.md)
    - [Project Harness](./harness.md)
    - [Product Canon](./PRODUCT.md)
    - [Design Canon](./DESIGN.md)
    - [Quality Canon](./QUALITY.md)
    - [Color Foundation](./foundation/colors.md)
  </Tab>
  <Tab title="Help">
    - [FAQ](./help/faq.md)
    - [Docs Troubleshooting](./help/troubleshooting-docs.md)
  </Tab>
</Tabs>
