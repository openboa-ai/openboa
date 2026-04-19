---
title: "옵저브"
summary: "Observe는 실행을 visible, accountable, explainable하게 만드는 governance and evidence surface다."
---
# 옵저브


`Observe`는 operator-facing evidence layer입니다.

아직 주 wedge는 아니지만, openboa에서는 1급 product surface로 봐야 합니다.
그렇지 않으면 실행 신뢰가 private runtime log와 구두 상태 보고에 머무르게 됩니다.

## Observe가 소유하는 것

- linked work item과 execution ref를 보여줍니다
- blocked, waiting, degraded 상태를 드러냅니다
- 관련 chat context와 execution evidence를 함께 붙입니다
- operator가 worker runtime 안으로 들어가지 않고도 실행을 이해하게 합니다

## Observe가 소유하지 않는 것

- chat transcript truth
- work commitment truth
- low-level runtime execution mechanics
- surface 아래에서 집행되는 policy enforcement 자체

## 레이어 관계

- `Work`가 commitment를 정의합니다
- `Observe`는 그 commitment의 실행과 증거를 설명합니다
- `Agent`는 session mechanics를 담당하고, `Observe`는 그 중 operator에게 필요한 evidence를 surface로 올립니다

## 다음으로 읽을 문서

- [Observe](../observe.md)
- [Work](../work.md)
- [Chat](../chat.md)
- [Agent](../agent.md)
