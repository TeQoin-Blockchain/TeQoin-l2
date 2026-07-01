# Branching Strategy

## Branches

- `main`: stable branch. Only release-ready code lands here.
- `develop`: integration branch for the next testnet/dev release.
- `feature/<name>`: new functionality, branched from `develop`.
- `fix/<name>`: non-urgent bug fixes, branched from `develop`.
- `hotfix/<name>`: urgent fixes, branched from `main` and merged back into both `main` and `develop`.
- `release/<version>`: release stabilization branch from `develop`.

## Merge rules

- Use pull requests for all changes.
- Do not push directly to `main` or `develop`.
- Squash or rebase merge feature branches unless preserving detailed history is useful.
- Release branches merge into `main`, then back into `develop`.
- Hotfix branches merge into `main`, tag if released, then merge/cherry-pick into `develop`.

## PR requirements

- CI must pass.
- Review by at least one owner.
- Protocol/security review for contracts, bridge logic, DA, batch submission, signer/nonce logic, fee logic, or fraud-proof code.
- Docs and runbooks updated when behavior or operations change.
- No secrets/generated runtime files included.

## Versioning and tags

Use semantic versioning where possible:

- `vMAJOR.MINOR.PATCH` for production/mainnet releases.
- `testnet-vMAJOR.MINOR.PATCH` for testnet-only releases.
- Pre-release tags may use `-rc.N`.

Every release tag should link to a release checklist and deployment notes.
