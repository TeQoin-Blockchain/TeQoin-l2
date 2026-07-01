# Security Review Guide

## Start Here

1. Read `README.md` for the system overview.
2. Read `docs/ARCHITECTURE.md` for component flow.
3. Read `docs/CONTRACTS.md` for contract map and high-risk areas.
4. Read `docs/AUDIT_SCOPE.md` for the intended audit scope.
5. Review `.github/workflows` and `scripts/check-repo-hygiene.sh` for repository hygiene.

## Local Commands

```bash
./scripts/check-repo-hygiene.sh
npm ci --prefix sequencer && npm run build --prefix sequencer
npm ci --prefix l2-indexer && npm run build --prefix l2-indexer
cd teqoin-core && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd sequencer && forge test
```

## Questions Reviewers Should Answer

- Can a legacy batch path bypass DA enforcement after activation?
- Can an invalid/disputed batch release withdrawals?
- Are withdrawal roots bound to exact batch numbers and block ranges?
- Are deposit IDs replay-protected on L1 and L2 paths?
- Can owner/sequencer/finalizer powers be abused or misconfigured?
- Are Diamond storage additions append-only and collision-safe?
- Are batch artifacts independently reconstructable from L1 DA?
- Are signer nonce/replacement/funding failures classified clearly?

## Sensitive Material Policy

Do not request raw private keys or production `.env` files. Ask for redacted environment key lists, deployment addresses, ABI files, storage diffs, and reproducible scripts instead.
