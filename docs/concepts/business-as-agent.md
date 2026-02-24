---
title: "Business as Agent"
summary: "Core BOA definition and the runtime building blocks used across openboa."
read_when:
  - You need the base concept before designing features
  - You want to align language across operator, agent, and contributor roles
---

Business as Agent (BOA) treats the business as the durable unit and agents as an evolvable workforce.
The core promise is continuity: the business identity and governance persist even when workers, tools, or workflows change.

<Tip>
BOA is not "more agents by default." It is controlled delegation with durable context and accountable decisions.
</Tip>

## Why BOA

- Preserve continuity while agent composition changes.
- Delegate specialized work without losing policy control.
- Keep memory and audit history attached to the business, not a single worker.

## Core Building Blocks

<CardGroup cols={2}>
  <Card title="boa">
    Durable runtime identity of the business and its long-lived state.
  </Card>
  <Card title="Operator">
    Human governor who sets goals, policy, and approval boundaries.
  </Card>
  <Card title="Agent">
    Worker entity that executes scoped responsibilities and evolves over time.
  </Card>
  <Card title="Skill">
    Reusable operational playbook that standardizes execution quality.
  </Card>
  <Card title="Protocol">
    Structured interaction contract for assign/report/approval/escalation flows.
  </Card>
  <Card title="Governance Boundary">
    Enforceable limits for permission, isolation, and risk control.
  </Card>
  <Card title="Audit Trail">
    Verifiable history of decisions and actions for accountability.
  </Card>
</CardGroup>

<Note>
This page is the conceptual baseline. Implementation details expand in additional guides and specs.
</Note>
