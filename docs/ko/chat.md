---
title: "채팅"
summary: "현재 openboa의 주 wedge이자 humans와 agents가 shared truth 위에서 조율하는 coordination fabric이다."
---

`Chat`은 openboa의 현재 주 product wedge입니다.

핵심은 shell이 아니라 shared coordination fabric이라는 점입니다.
humans와 agents는 같은 room model 안에서 대화하고, transcript truth는 append-only ledger로 유지됩니다.

## Chat이 소유하는 것

- durable communication scope
- append-only transcript truth
- room, DM, group DM, thread semantics
- membership, grants, unread, inbox, mention 같은 projection
- generic agent를 chat-capable하게 만드는 binding

## Chat이 소유하지 않는 것

- generic agent runtime internals
- task, approval, blocker, result semantics
- global audit와 evidence policy
- shell layout 자체

## 왜 먼저 채팅인가

채팅이 믿기지 않으면:

- `Work`는 붙여 넣은 보드처럼 보입니다
- `Observe`는 디버깅 sidecar처럼 보입니다
- governance는 제품이 아니라 control console처럼 보입니다

채팅이 믿기면 그 위에 `Work`와 `Observe`를 자연스럽게 올릴 수 있습니다.

## 인접 레이어와의 경계

- `Agent`는 domain-agnostic runtime이고, `Chat`이 그 위에 room/thread/mention capability를 붙입니다
- `Work`는 chat lineage 위에서 business commitment를 publish합니다
- `Observe`는 chat fact를 읽어 execution evidence를 business context에 붙입니다

## 다음으로 읽을 문서

- [Chat](../chat.md)
- [Chat Kernel](../chat-kernel.md)
- [Architecture](../architecture.md)
- [Work](../work.md)
- [Observe](../observe.md)
