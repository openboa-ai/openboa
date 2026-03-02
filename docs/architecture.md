# Architecture

## Purpose of This Document

This page is intentionally rough.

The goal is **not** to finalize implementation details.
The goal is to identify:
1) what architecture topics must be considered,
2) why each topic matters,
3) what should be detailed in follow-up threads.

---

## Reference Foundations

### 1) Event-Driven Architecture
- Martin Fowler: <https://martinfowler.com/articles/201701-event-driven.html>
- Microsoft Azure Architecture Center: <https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven>

### 2) Workflow Engine Principles
- Temporal: <https://temporal.io/blog/workflow-engine-principles>

### 3) RBAC Standard Model
- NIST RBAC: <https://www.nist.gov/publications/nist-model-role-based-access-control-towards-unified-standard>

### 4) Policy as Code
- Open Policy Agent (OPA): <https://www.openpolicyagent.org/docs/latest/>

### 5) Tooling Protocol Foundation
- Model Context Protocol (MCP): <https://modelcontextprotocol.io/introduction>

### 6) Agent-to-Agent Interoperability Foundation
- Agent2Agent Protocol (A2A): <https://github.com/a2aproject/A2A>

---

## Reference Mapping by Architecture Topic

- **Control Plane / Event-Driven Runtime / Messages / Observability** → event-driven
- **Run/Session Lifecycle / Reliability** → workflow-engine
- **Policy & Access Control / Organization Context** → nist-rbac, opa
- **Tools** → mcp
- **A2A Communication** → a2a
- **Memory / Skills** → architecture-principle

Reference tags:
- `event-driven`, `workflow-engine`, `nist-rbac`, `opa`, `mcp`, `a2a`, `architecture-principle`

---

## Architecture Consideration Checklist

## 1) Control Plane `[ref: event-driven]`
## 2) Event-Driven Runtime `[ref: event-driven]`
## 3) Run/Session Lifecycle `[ref: workflow-engine]`
## 4) Queue & Concurrency Model `[ref: workflow-engine, event-driven]`
## 5) Runtime vs Business Layer Boundary `[ref: architecture-principle]`
## 6) Policy & Access Control (RBAC/RoleBinding) `[ref: nist-rbac, opa]`
## 7) Organization Context Model `[ref: nist-rbac, opa]`
## 8) Messages `[ref: event-driven]`
## 9) Tools (MCP-aligned) `[ref: mcp]`
## 10) Memory `[ref: architecture-principle]`
## 11) Skills `[ref: architecture-principle]`
## 12) A2A Communication `[ref: a2a]`
## 13) Observability & Audit `[ref: event-driven, workflow-engine]`
## 14) Reliability (Retry/Idempotency/Recovery) `[ref: workflow-engine]`
