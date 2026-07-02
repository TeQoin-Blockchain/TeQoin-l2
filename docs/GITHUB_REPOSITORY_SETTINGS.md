# Recommended GitHub Repository Settings

## Branch protection

Protect `main`:

- Require pull request before merging.
- Require at least 2 approvals for protocol/security-sensitive repositories.
- Require CODEOWNERS review.
- Require status checks to pass.
- Require branches to be up to date before merge.
- Require signed commits if the team can support it.
- Restrict who can push.
- Disallow force-push and deletion.

Protect `develop`:

- Require pull request before merging.
- Require at least 1 approval.
- Require CI status checks.
- Disallow force-push and deletion.

## Environments

Create GitHub Environments:

- `testnet`: manual approval optional, testnet secrets only.
- `mainnet`: manual approval required, restricted reviewers, production secrets only.

## Secrets

Use GitHub Actions secrets/environment secrets for:

- RPC URLs
- deployer keys or signer credentials, preferably through short-lived secret manager integration
- Etherscan/Sourcify API keys
- Docker registry credentials
- notification webhooks

Never store private keys in repository files.

## Security features

Enable:

- Dependabot alerts
- Dependabot security updates
- Secret scanning
- Push protection
- Code scanning where available

## Optional Admin Bootstrap Script

After creating a fine-grained GitHub token with repository administration permission, an owner can apply the baseline branch and environment settings from a shell session without storing the token on disk:

```bash
export GITHUB_TOKEN='<fine-grained-admin-token>'
export PRODUCTION_REVIEWER_USER='<github-username-for-mainnet-approval>'
./scripts/configure-github-repository.sh
unset GITHUB_TOKEN
```

The script creates `develop` and `test` from `main` if they do not exist, protects `main`, `develop`, and `test`, and creates `testnet` and `mainnet` environments. It intentionally does not write deployment secrets; add secrets only through GitHub Secrets or environment secrets.


## Private Repository Plan Note

GitHub branch protection and Dependency Review features may require GitHub Pro, Team, Enterprise, or GitHub Advanced Security when the repository is private. If those features are unavailable, keep CI/security workflows active and enforce pull-request discipline operationally until the repository plan supports native enforcement.
