#!/usr/bin/env bash
set -euo pipefail

OWNER="${GITHUB_OWNER:-0xakileet}"
REPO="${GITHUB_REPO:-TeQoin-l2}"
API="${GITHUB_API_URL:-https://api.github.com}"
TOKEN="${GITHUB_TOKEN:-}"
PRODUCTION_REVIEWER_USER="${PRODUCTION_REVIEWER_USER:-}"

if [ -z "$TOKEN" ]; then
  echo "GITHUB_TOKEN is required. Use a fine-grained token with repository Administration:write, Contents:write, Metadata:read, and Actions/Secrets permissions as needed." >&2
  exit 1
fi

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [ -n "$data" ]; then
    curl -fsS -X "$method" \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer $TOKEN" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$API$path" \
      -d "$data"
  else
    curl -fsS -X "$method" \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer $TOKEN" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$API$path"
  fi
}

ensure_branch() {
  local branch="$1"
  if api GET "/repos/$OWNER/$REPO/branches/$branch" >/dev/null 2>&1; then
    echo "Branch exists: $branch"
    return
  fi

  local main_sha
  main_sha="$(api GET "/repos/$OWNER/$REPO/git/ref/heads/main" | python3 -c 'import json,sys; print(json.load(sys.stdin)["object"]["sha"])')"
  api POST "/repos/$OWNER/$REPO/git/refs" "{\"ref\":\"refs/heads/$branch\",\"sha\":\"$main_sha\"}" >/dev/null
  echo "Created branch $branch from main"
}

protect_branch() {
  local branch="$1"
  local approvals="$2"

  local contexts_json='[
    "Repository hygiene",
    "TypeScript build (sequencer)",
    "TypeScript build (l2-indexer)",
    "Rust core",
    "Solidity / Foundry",
    "Docker build checks",
    "Secret scan",
    "npm audit (sequencer)",
    "npm audit (l2-indexer)"
  ]'

  python3 - "$branch" "$approvals" "$contexts_json" <<'PY' > /tmp/teqoin_branch_protection.json
import json, sys
branch, approvals, contexts = sys.argv[1], int(sys.argv[2]), json.loads(sys.argv[3])
payload = {
    "required_status_checks": {"strict": True, "contexts": contexts},
    "enforce_admins": True,
    "required_pull_request_reviews": {
        "dismiss_stale_reviews": True,
        "require_code_owner_reviews": branch == "main",
        "required_approving_review_count": approvals,
        "require_last_push_approval": True,
    },
    "restrictions": None,
    "required_linear_history": True,
    "allow_force_pushes": False,
    "allow_deletions": False,
    "block_creations": False,
    "required_conversation_resolution": True,
    "lock_branch": False,
    "allow_fork_syncing": True,
}
print(json.dumps(payload))
PY

  api PUT "/repos/$OWNER/$REPO/branches/$branch/protection" "$(cat /tmp/teqoin_branch_protection.json)" >/dev/null
  rm -f /tmp/teqoin_branch_protection.json
  echo "Protected branch: $branch"
}

reviewer_payload='{}'
if [ -n "$PRODUCTION_REVIEWER_USER" ]; then
  reviewer_id="$(api GET "/users/$PRODUCTION_REVIEWER_USER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
  reviewer_payload="{\"wait_timer\":0,\"reviewers\":[{\"type\":\"User\",\"id\":$reviewer_id}],\"deployment_branch_policy\":null}"
else
  echo "PRODUCTION_REVIEWER_USER is not set; mainnet environment will be created without required reviewers. Add reviewers in GitHub UI or rerun with PRODUCTION_REVIEWER_USER=username."
fi

ensure_branch develop
ensure_branch test
protect_branch main 2
protect_branch develop 1
protect_branch test 1

api PUT "/repos/$OWNER/$REPO/environments/testnet" '{"wait_timer":0,"deployment_branch_policy":null}' >/dev/null
api PUT "/repos/$OWNER/$REPO/environments/mainnet" "$reviewer_payload" >/dev/null

echo "Created/updated GitHub environments: testnet, mainnet"
echo "Done. Add environment/repository secrets through GitHub Secrets only; this script intentionally does not accept or store secret values."
