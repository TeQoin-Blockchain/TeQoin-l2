# Development Checklist

Before opening a PR:

- [ ] Branch name follows `feature/*`, `fix/*`, `hotfix/*`, or `release/*`.
- [ ] Change is atomic and has a clear purpose.
- [ ] `.gitignore` still excludes generated/runtime/secret files.
- [ ] No `.env`, private keys, mnemonic phrases, wallet files, logs, DB files, or node data are staged.
- [ ] Relevant TypeScript packages build.
- [ ] Rust code is formatted, clippy-clean, and tested if touched.
- [ ] Foundry tests pass if contracts are touched.
- [ ] ABI/deployment/runbook docs updated if contracts or scripts changed.
- [ ] Migrations are documented and backward-compatible where possible.
- [ ] Monitoring/alerting updated for new operational behavior.

Recommended local commands:

```bash
./scripts/check-repo-hygiene.sh
npm ci --prefix sequencer && npm run build --prefix sequencer
npm ci --prefix l2-indexer && npm run build --prefix l2-indexer
npm ci --prefix sepolia-indexer && npm run build --prefix sepolia-indexer
cd teqoin-core && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd sequencer && forge test
```
