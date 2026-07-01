# Roadmap

## Phase 1: Testnet hardening

- Stabilize sequencer, batch submission, withdrawal queue/finalization.
- Keep Blob DA controlled-test verified and monitor lifecycle state.
- Harden websocket replay/recovery and indexer APIs.
- Add CI/CD, branch discipline, repo hygiene, and audit package.

## Phase 2: Production-readiness foundation

- Mandatory Blob DA activation with repeated successful beacon verification.
- Independent L1-first challenger/verifier reconstruction.
- Fee shadow accounting and L1/blob cost reporting.
- Multisig/timelock for owner powers.
- Signer separation, balance alerts, nonce/replacement monitoring.

## Phase 3: Fraud-proof production path

- Deterministic derivation from L1 DA.
- Canonical pre-state loading.
- Independent batch re-execution / shadow verifier.
- State witness and preimage model.
- Step trace and bisection protocol.
- On-chain dispute resolution and slashing rules.
- Full EVM fault-proof VM design and implementation.

## Phase 4: Mainnet readiness

- External audits and remediation review.
- Production monitoring and incident response.
- Load testing and disaster recovery drills.
- Mainnet deployment runbooks and governance controls.
