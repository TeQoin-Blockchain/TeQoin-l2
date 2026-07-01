# Contributing to TeQoin

TeQoin is blockchain infrastructure. Treat every change as production-sensitive, even when it targets testnet.

## Branch model

- `main` is stable and production-ready.
- `develop` is the integration branch for accepted work before release.
- `feature/<short-name>` is for new functionality.
- `fix/<short-name>` is for normal bug fixes.
- `hotfix/<short-name>` is for urgent production/testnet fixes branching from `main`.
- `release/<version>` is for release hardening, audit fixes, and final checks.

See `docs/BRANCHING_STRATEGY.md` for the full workflow.

## Pull request rules

Before opening a PR:

- Rebase or merge the latest target branch.
- Run the relevant local checks from `docs/DEVELOPMENT_CHECKLIST.md`.
- Confirm no secrets or generated runtime files are staged.
- Update docs, examples, migrations, and ABI notes when behavior changes.
- Mark risky operational changes clearly in the PR description.

Required before merge:

- CI must pass.
- At least one code owner review is required for normal changes.
- Security-sensitive or protocol-sensitive changes require review from a protocol/security owner.
- Contract storage layout, Diamond cuts, bridge logic, DA logic, or signer/nonce logic require explicit review notes.

## Commit style

Use conventional commit style where practical:

- `feat(sequencer): ...`
- `fix(bridge): ...`
- `chore(ci): ...`
- `docs(devops): ...`
- `test(fraudproof): ...`
- `security(repo): ...`

Keep commits atomic. Do not mix unrelated runtime fixes, docs, formatting, and deployment changes in one commit.

## Secrets

Never commit private keys, mnemonic phrases, RPC secrets, API keys, `.env` files, wallet files, cloud credentials, certificates, database dumps, or node data.

Use GitHub Secrets or environment-specific secret managers for deployment and RPC credentials.

## Generated files

Do not commit dependency installs or build outputs:

- `node_modules`
- `dist`
- Rust `target`
- Foundry `out`, `cache`, `broadcast`
- logs, databases, chain data, batch artifact stores

Lockfiles are allowed and expected for reproducible builds.
