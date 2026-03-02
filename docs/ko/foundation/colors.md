---
title: "Color Foundation"
summary: "openboa 토큰 기반 팔레트: Green(브랜드), Gray(텍스트), Sand(서피스)"
read_when:
  - 문서/UI에서 공유 색상 계약이 필요할 때
  - 가독성을 해치지 않고 브랜드 톤을 유지하고 싶을 때
---

openboa 팔레트는 역할 기준으로 구성됩니다.

- **Green**: 브랜드/강조
- **Gray**: 텍스트/구조
- **Sand**: 따뜻한 배경/레이어

<Warning>
라이트 배경에서 긴 본문 텍스트에 green 토큰(`#8CC92A`, `#478D24`)을 사용하지 마세요.
</Warning>

<Tip>
`#EDDBB7`와 `#EEDCB6`는 실사용에서 거의 동일 톤이므로 하나의 sand 계열로 취급하세요.
</Tip>

## Semantic Mapping

- `--boa-bg` → `sand-50` (light), `green-900` (dark)
- `--boa-surface` → near-white elevated panel
- `--boa-panel` → warm sand panel (light), deep green panel (dark)
- `--boa-text` → `gray-900` (light), `sand-50` (dark)
- `--boa-border` → `gray-200` (light), dark neutral border in dark mode
- `--boa-accent` → `green-500` (light), `green-600` (dark)
- `--boa-accent-strong` → `green-700` (light), `green-500` (dark)

<Note>
세부 색상 토큰(swatches)은 영문 원문과 동일 값으로 유지하며, 이후 UI 토큰 표를 한국어 표기와 함께 확장할 수 있습니다.
</Note>
