#!/usr/bin/env bash
set -euo pipefail

MSG_FILE="${1:-}"
if [[ -z "$MSG_FILE" || ! -f "$MSG_FILE" ]]; then
  echo "[commit-msg] commit message file not found: $MSG_FILE" >&2
  exit 1
fi

SUBJECT="$(grep -vE '^\s*#' "$MSG_FILE" | sed '/^\s*$/d' | head -n 1 || true)"

if [[ -z "$SUBJECT" ]]; then
  echo "[commit-msg] empty commit message." >&2
  exit 1
fi

# Allow Git-generated merge/revert subjects.
if [[ "$SUBJECT" =~ ^Merge\  ]] || [[ "$SUBJECT" =~ ^Revert\  ]]; then
  exit 0
fi

# Open-source friendly convention: type: description
PATTERN='^(feat|fix|docs|chore|refactor|test|ci|build|perf|revert): .+$'

if [[ ! "$SUBJECT" =~ $PATTERN ]]; then
  cat >&2 <<'EOF'
[commit-msg] Invalid format.
Required: type: description

Examples:
  docs: refine fundamentals chat contract
  feat: add runtime checkpoint recovery
EOF
  echo "Found: $SUBJECT" >&2
  exit 1
fi
