# Production Readiness Checklist

## Protocol

- [ ] Blob DA mandatory and non-bypassable after activation.
- [ ] Batch commitments bind DA, transactions root, withdrawals root, pre/post state roots, and block ranges.
- [ ] Bridge withdrawals are tied to valid, non-invalidated batches.
- [ ] Deposit replay protection verified.
- [ ] Withdrawal replay/finality/challenge rules verified.
- [ ] Fraud-proof limitations documented.

## Contracts

- [ ] Diamond storage layout reviewed.
- [ ] Selector collisions checked.
- [ ] Owner powers moved to multisig/timelock.
- [ ] Upgrade runbooks tested.
- [ ] Foundry tests cover happy paths and attacker paths.
- [ ] External audit completed.

## Services

- [ ] Sequencer restart/recovery tested.
- [ ] L1 tx nonce/replacement manager tested.
- [ ] Signer separation enforced.
- [ ] Blob lifecycle state monitored.
- [ ] Indexer lag monitored.
- [ ] Websocket replay recovery monitored.

## Infrastructure

- [ ] SSH key-only access.
- [ ] Firewall allow-list policy.
- [ ] No dangerous RPC namespaces public.
- [ ] Docker log rotation enabled.
- [ ] Disk alerts configured.
- [ ] Secrets manager plan implemented.
- [ ] Backups and restore drills complete.
