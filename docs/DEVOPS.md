# DevOps Notes

## Deployment philosophy

CI verifies code. CD should be manual and environment-protected until deployment automation is fully audited.

- Testnet deployments may be triggered manually from `develop` or release branches.
- Mainnet deployments must only be possible from `main` or signed release tags.
- Production deployments require manual approval and a release checklist.

## Operational safety

- Do not deploy automatically from arbitrary PRs.
- Do not expose secrets to pull requests from forks.
- Keep deployment keys separated by environment and role.
- Prefer multisig/timelock for contract owner powers.
- Keep rollback instructions next to every release.

## Monitoring areas

- Sequencer block production
- Batch submission age
- Blob DA lifecycle and beacon verification
- Withdrawal queue/finalization lag
- Deposit processing lag
- Signer balances and pending nonce depth
- L2 indexer lag
- Sepolia/L1 indexer lag
- RPC error rate and latency
- Disk, Docker logs, DB size, Redis health
