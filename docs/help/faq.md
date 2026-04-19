---
title: "FAQ"
summary: "Common questions on openboa scope, maturity, and docs-first development approach."
read_when:
  - You need quick orientation on what openboa currently supports
  - You want a concise answer before diving into concept pages
---

<AccordionGroup>
  <Accordion title="What is openboa?">
    openboa is a Business as Agent (BOA) system. It keeps the business as the durable operating subject and treats agents as an evolvable workforce.
  </Accordion>
  <Accordion title="How is openboa structured?">
    The product stack is `Agent -> Chat -> Work -> Observe`. Agent is the worker runtime, Chat is shared coordination, Work is business execution, and Observe is governance and evidence.
  </Accordion>
  <Accordion title="What is the current wedge?">
    The current first believable wedge is Chat. openboa is being built as a chat-first company runtime, while Work and Observe remain first-class product surfaces that are still earlier in implementation maturity.
  </Accordion>
  <Accordion title="What is actually implemented today?">
    The current code reality is uneven by design. Agent is already a real session-first runtime, Chat already has real shared truth and projections, and Work plus Observe currently exist mainly as shared model types and shell scaffolding.
  </Accordion>
  <Accordion title="Is this a generic chatbot framework?">
    No. Chat is the current wedge, but openboa is not “just chat.” It is trying to become a business operating system where coordination, execution, and evidence remain durable across changing workers and tools.
  </Accordion>
  <Accordion title="Who is this for?">
    Builders who want agent-based execution without giving up policy control, memory continuity, auditability, and explicit business ownership.
  </Accordion>
  <Accordion title="Is a human always in control?">
    Yes. Humans still set direction, approval boundaries, quality bar, and final signoff. openboa is not pursuing a no-operator fully autonomous model.
  </Accordion>
  <Accordion title="Why docs first?">
    Stable canon docs keep product meaning, architectural boundaries, design taste, and quality expectations aligned before autonomous implementation complexity grows.
  </Accordion>
  <Accordion title="What should contributors assume right now?">
    Contributors should assume that surface boundaries matter more than temporary implementation convenience. Agent, Chat, Work, and Observe should stay conceptually distinct even when some layers are still scaffolded.
  </Accordion>
  <Accordion title="How should I start reading?">
    Start with Introduction, then Business as Agent, Core Doctrine, and Architecture. After that, read the surface docs in order: Agent, Chat, Work, and Observe.
  </Accordion>
</AccordionGroup>

## Start Reading

<CardGroup cols={2}>
  <Card title="Introduction" href="/introduction">
    The shortest path to what openboa is, why it exists, and the current maturity split.
  </Card>
  <Card title="Business as Agent" href="/concepts/business-as-agent">
    Core BOA model and building blocks.
  </Card>
  <Card title="Architecture" href="/architecture">
    Surface-first architecture, code reality, and truth boundaries.
  </Card>
  <Card title="Agent / Chat / Work / Observe" href="/agent">
    The top-level product surfaces and how they relate.
  </Card>
  <Card title="Development" href="/development">
    Local workflow, contribution loop, and validation commands.
  </Card>
</CardGroup>
