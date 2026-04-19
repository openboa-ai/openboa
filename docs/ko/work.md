---
title: "워크"
summary: "Work는 Chat 위에서 대화를 explicit business commitment와 execution object로 올리는 레이어다."
---

`Work`는 generic task board가 아니라 business execution layer입니다.

채팅에서 나온 조율 중 일부를 durable business commitment로 승격하고, owner, state, blocker, approval, result 같은 execution meaning을 붙입니다.

## Work가 소유하는 것

- business execution object
- ownership과 participation
- blocker, approval, result semantics
- chat lineage에서 work lineage로의 publication
- execution ref와 durable asset promotion

## Work가 소유하지 않는 것

- room, DM, thread truth
- generic agent runtime behavior
- global audit와 evidence semantics
- shell 보드 표현 그 자체

## Work가 필요한 이유

- 중요한 실행이 private agent workspace 안에 갇히면 안 됩니다
- business-relevant output은 durable company-owned state가 되어야 합니다
- 채팅만으로는 commitment와 execution history를 안정적으로 유지하기 어렵습니다

## 레이어 관계

- `Chat`은 무엇이 어디서 말해졌는지 답합니다
- `Work`는 어떤 business commitment가 생겼는지 답합니다
- `Observe`는 그 실행이 실제로 어떻게 진행되고 있는지 설명합니다

## Work가 답해야 하는 질문

1. 왜 이 commitment가 존재하는가
2. 어떤 chat lineage나 execution lineage에서 왔는가
3. 지금 누가 소유하는가
4. 어떤 blocker, decision, execution이 붙어 있는가
5. business가 얻은 durable result는 무엇인가

## 다음으로 읽을 문서

- [Work](../work.md)
- [Chat](../chat.md)
- [Observe](../observe.md)
- [Agent Runtime](../agent-runtime.md)
