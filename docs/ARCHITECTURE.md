# TeQoin Architecture

This document gives security reviewers, protocol engineers, and backend/frontend developers a practical map of the TeQoin L2 system.

## System Layers

| Layer | Responsibility | Main Code Areas |
| --- | --- | --- |
| L1 contracts | Bridge custody, batch commitments, DA references, withdrawal/finality rules, dispute/fraud-proof foundation. | `sequencer/src/contracts/diamond`, `sequencer/src/contracts/fraudproof` |
| L2 execution | EVM-compatible block execution and RPC surface. | `teqoin-geth`, runtime node configuration |
| Sequencer services | L1 deposit ingestion, L2 deposit processing, batch planning/submission, withdrawal queue/finalization, DA, fee oracle, monitoring. | `sequencer/src/services` |
| Rust core | Deterministic Merkle, batch codec, compression, crypto, and L1 transaction manager foundations. | `teqoin-core` |
| Indexers | L2/L1 transaction, block, bridge, faucet, stats, websocket, and replay APIs. | `l2-indexer`, `sepolia-indexer` |
| Operational infra | Docker, systemd, nginx/RPC filtering, Postgres, Redis, log/disk guards. | server deployment config, runbooks |

## High-Level Flow

```text
User / Backend / Frontend
        |
        v
Public L2 RPC / APIs / Websocket
        |
        v
TeQoin L2 execution node ----> L2 indexer ----> Explorer / backend APIs
        |
        v
Sequencer services
        |
        +--> process L1 deposits on L2
        +--> build and submit state batches
        +--> publish / verify DA commitments
        +--> queue and finalize withdrawals
        +--> update fee oracle and operational metrics
        |
        v
Ethereum Sepolia L1 contracts
```

## Batch Lifecycle

1. Sequencer observes the L2 canonical head.
2. Batch planner selects a block range using configured sizing rules.
3. Batch builder collects block metadata, transactions, withdrawals, and roots.
4. Rust Merkle and batch codec paths build/verifiy commitment data.
5. Compression and DA artifact paths prepare batch data.
6. L1 transaction manager submits the state batch / DA commitment.
7. Withdrawal queueing uses the committed withdrawal root and batch number.
8. Indexers record batch, bridge, and transaction lifecycle data.
9. Watchers/verifiers monitor continuity, roots, DA availability, and challenge windows.

## Bridge Lifecycle

### L1 to L2 Deposit

1. User deposits ETH/ERC-20 on L1 bridge.
2. L1 listener indexes deposit event and records cursor/checkpoint.
3. Sequencer processes the deposit on L2 bridge.
4. L2 bridge credits ETH or mints mapped wrapped token.
5. L2 indexer exposes settlement and bridge context.

### L2 to L1 Withdrawal

1. User initiates withdrawal on L2 bridge.
2. L2 withdrawal listener records withdrawal ID, token, recipient, amount, and block.
3. Batch submitter commits a batch containing the withdrawal root.
4. L1 bridge queues withdrawals tied to the committed batch/root.
5. Challenge/finality window must pass.
6. Finalizer releases L1 funds or marks finalization lifecycle.

## DA / Blob Path

Current production track prefers Ethereum L1 DA. R2/S3 is not canonical DA.

Expected L1-first verifier flow:

```text
L1 batch commitment
        |
        v
blob/calldata reference
        |
        v
fetch L1-available data
        |
        v
decompress zstd batch bytes
        |
        v
decode Rust batch codec
        |
        v
verify transactionsRoot / withdrawalsRoot / range / state roots
```

## Fraud-Proof Status

TeQoin currently has an enforceable fraud-proof foundation and monitoring/dispute scaffolding. It is not yet a complete Cannon-style full EVM fault-proof VM.

Production path:

- Deterministic derivation from L1 DA.
- Canonical pre-state loading.
- Independent batch re-execution.
- State witness and preimage model.
- Step trace and bisection protocol.
- On-chain dispute resolution.
- Bonding, slashing, and finality rules.

## Trust Boundaries

| Boundary | Risk | Current Control |
| --- | --- | --- |
| Sequencer signer | Can submit batches / process privileged flows. | Key separation, signer balance monitoring, service-level controls. |
| Owner / diamond upgrade | Can change protocol behavior. | Should be multisig/timelock before mainnet. |
| L1 DA commitment | Bad/missing DA breaks independent verification. | Blob/calldata verification path under hardening. |
| Indexer/API | Data correctness and availability risk. | DB migrations, replay/recovery, monitoring, rate limits. |
| Websocket consumers | Disconnects may lose live events. | Cursor-based replay/recovery API. |

## Non-Goals For Current Testnet

- Claiming complete mainnet-grade fault proof security.
- Automatic production deployment from GitHub Actions.
- Publicly exposing private keys, RPC admin namespaces, or internal DB credentials.
