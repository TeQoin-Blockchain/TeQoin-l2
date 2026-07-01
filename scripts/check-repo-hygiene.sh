#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

status=0

echo "== Repository hygiene check =="

echo "Checking staged files for sensitive/generated paths..."
if git rev-parse --git-dir >/dev/null 2>&1; then
  staged="$(git diff --cached --name-only || true)"
else
  staged=""
fi

if [ -n "$staged" ]; then
  bad_paths="$(printf '%s\n' "$staged" | grep -Ei '(^|/)(\.env|node_modules|target|dist|build|out|cache|logs|broadcast|artifacts)(/|$)|private|secret|mnemonic|keystore|wallet.*\.txt|\.pem$|\.key$|\.p12$|\.pfx$|\.sqlite|\.db$|\.log$' || true)"
  if [ -n "$bad_paths" ]; then
    echo "ERROR: staged files include sensitive/generated-looking paths:"
    printf '%s\n' "$bad_paths"
    status=1
  fi
else
  echo "No staged files."
fi

echo "Checking tracked files for generated dependency/runtime directories..."
tracked_bad="$(git ls-files 2>/dev/null | grep -E '(^|/)(node_modules|target|dist|build|out|cache|logs|broadcast|artifacts)(/|$)|\.sqlite|\.db$|\.log$' || true)"
if [ -n "$tracked_bad" ]; then
  echo "ERROR: generated/runtime files are tracked:"
  printf '%s\n' "$tracked_bad"
  status=1
fi

echo "Checking tracked files for high-risk secret names..."
tracked_secret_names="$(git ls-files 2>/dev/null | grep -Ei '(^|/)(\.env|.*private.*|.*secret.*|.*mnemonic.*|.*keystore.*|.*wallet.*\.txt|.*\.pem|.*\.key|.*\.p12|.*\.pfx)$' || true)"
if [ -n "$tracked_secret_names" ]; then
  echo "ERROR: high-risk secret-looking files are tracked:"
  printf '%s\n' "$tracked_secret_names"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "Repository hygiene check passed."
else
  echo "Repository hygiene check failed."
fi

exit "$status"
