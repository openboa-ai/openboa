# OpenBoa CLI Architecture (OpenClaw-style)

## 목표
`openboa` CLI를 **명령 트리 + 런타임 분리** 구조로 정리해 OpenClaw와 유사한 확장성을 확보한다.

## 구조

```text
openboa (entry)
├─ parser layer      (src/cli/parser.ts)
│  ├─ command parsing (setup/agent/serve/tui/codex-login...)
│  ├─ options parser (--name, --chat-id...)
│  └─ usage rendering
├─ command dispatcher (src/index.ts)
│  ├─ setup
│  ├─ agent spawn/list/chat
│  ├─ serve(API 서버)
│  ├─ codex-login
│  ├─ tui
│  └─ oneshot chat
└─ runtime layer
   ├─ setup: src/runtime/setup.ts
   ├─ chat: src/runtime/chat.ts
   ├─ api-server: src/runtime/api-server.ts
   ├─ codex-auth: src/runtime/auth/codex-oauth-login.ts
   └─ tui: src/runtime/tui.ts
```

## 명령 체계
- `openboa setup`
- `openboa agent spawn --name <agent-id>`
- `openboa agent list`
- `openboa agent chat --name <agent-id> [--chat-id ...] [--session-id ...] [--sender-id ...]`
- `openboa setup-codex-pi-agent [agent-id]`
- `openboa codex-login`
- `openboa serve`
- `openboa <free text>` (원샷 채팅)

## 테스트 전략
- `test/cli.parser.test.ts`: 파서 단위
- `test/cli.runtime.test.ts`: 디스패처/핸들러 연결 단위

## 추가로 설계된 고정 원칙
- 인증 분리는 `codex-login` 진입점으로 고정.
- `oneshot`은 런타임 명령 파싱과 분리하여 단일 함수에서 모킹 테스트 가능.
- `runCli(args)`를 노출해 CLI 시작점과 로직을 분리.
