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
