# TeQoin Architecture

This document describes the TeQoin L2 architecture for protocol engineers, infrastructure partners, auditors, backend developers, frontend integrators, and node operators.

## Architecture Summary

TeQoin is organized around six core planes:

| Plane | Responsibility |
| --- | --- |
| Access plane | Public RPC, REST APIs, websocket feeds, replay recovery, and external integrations. |
| Execution plane | EVM-compatible L2 block production, state transition, transaction inclusion, and L2 contracts. |
| Sequencing plane | Batch planning, deposit processing, withdrawal tracking, DA publishing, L1 submission, and signer coordination. |
| Settlement plane | Ethereum L1 diamond contracts, bridge custody, batch commitments, finality, and DA references. |
| Data plane | PostgreSQL, Redis where used, indexers, bridge lifecycle records, cursor replay, and analytics. |
| Verification plane | Merkle checks, codec checks, DA verification, challenger/verifier foundations, monitoring, and audit trails. |

## Full System Diagram

```mermaid
flowchart TB
  classDef access fill:#eff6ff,stroke:#2563eb,color:#0f172a
  classDef exec fill:#ecfdf5,stroke:#059669,color:#0f172a
  classDef seq fill:#fefce8,stroke:#ca8a04,color:#0f172a
  classDef l1 fill:#fff7ed,stroke:#ea580c,color:#0f172a
  classDef data fill:#f8fafc,stroke:#64748b,color:#0f172a
  classDef verify fill:#fef2f2,stroke:#dc2626,color:#0f172a

  subgraph Access[Access Plane]
    rpc[Public L2 RPC]
    api[L2 REST API]
    ws[Websocket Gateway]
    replay[Replay By Cursor]
  end

  subgraph Execution[Execution Plane]
    l2geth[TeQoin L2 Node]
    l2bridge[L2 Bridge]
    faucet[L2 Faucet]
    tokens[Wrapped Tokens]
  end

  subgraph Sequencing[Sequencing Plane]
    manager[Sequencer Manager]
    deposits[Deposit Processor]
    withdrawals[Withdrawal Listener]
    batcher[Batch Submitter]
    finalizer[Withdrawal Finalizer]
    feeOracle[Fee Oracle Updater]
  end

  subgraph Native[Native Core]
    merkle[Rust Merkle]
    codec[Rust Batch Codec]
    zstd[Rust Compression]
    crypto[Rust Crypto]
    l1tx[L1 Tx Manager]
  end

  subgraph Settlement[Ethereum L1 Settlement]
    diamond[Diamond Proxy]
    bridgeFacet[Bridge Facet]
    sequencerFacet[Sequencer Facet]
    da[Blob / Calldata DA]
    dispute[Fraud-Proof Foundation]
  end

  subgraph Data[Data Plane]
    postgres[(PostgreSQL)]
    redis[(Redis)]
    l2indexer[L2 Indexer]
    l1indexer[L1 Indexer]
  end

  subgraph Verification[Verification Plane]
    l1first[L1-First Verifier]
    watchtower[Watchtower / Monitors]
    alerts[Alerting]
  end

  rpc --> l2geth
  api --> postgres
  ws --> postgres
  replay --> postgres
  l2geth --> manager
  l2geth --> l2indexer
  l2bridge --> l2indexer
  manager --> deposits
  manager --> withdrawals
  manager --> batcher
  manager --> finalizer
  manager --> feeOracle
  batcher --> merkle
  batcher --> codec
  batcher --> zstd
  batcher --> crypto
  batcher --> l1tx
  l1tx --> diamond
  batcher --> da
  diamond --> bridgeFacet
  diamond --> sequencerFacet
  diamond --> dispute
  bridgeFacet --> l1indexer
  sequencerFacet --> l1indexer
  l2indexer --> postgres
  l1indexer --> postgres
  api --> redis
  da --> l1first
  sequencerFacet --> l1first
  l1first --> watchtower
  watchtower --> alerts
  postgres --> watchtower

  class rpc,api,ws,replay access
  class l2geth,l2bridge,faucet,tokens exec
  class manager,deposits,withdrawals,batcher,finalizer,feeOracle seq
  class merkle,codec,zstd,crypto,l1tx data
  class diamond,bridgeFacet,sequencerFacet,da,dispute l1
  class postgres,redis,l2indexer,l1indexer data
  class l1first,watchtower,alerts verify
```

## Protocol Lifecycle

```mermaid
stateDiagram-v2
  [*] --> L2Execution
  L2Execution --> BatchPlanning: New canonical blocks
  BatchPlanning --> RootConstruction: Select batch range
  RootConstruction --> Encoding: Build tx and withdrawal roots
  Encoding --> Compression: Encode and compress batch bytes
  Compression --> DataAvailability: Publish blob or calldata reference
  DataAvailability --> L1Commitment: Submit batch metadata
  L1Commitment --> WithdrawalQueueing: Queue included withdrawals
  WithdrawalQueueing --> ChallengeWindow: Wait finality period
  ChallengeWindow --> Finalization: Finalize valid withdrawals
  Finalization --> Indexed: Expose via APIs and websocket
  Indexed --> [*]
```

## Batch Construction Detail

```mermaid
flowchart LR
  H[L2 head] --> P[Planner]
  P --> S{Sizing inputs}
  S --> T[Transaction pressure]
  S --> W[Withdrawal urgency]
  S --> G[Gas / DA cost signal]
  S --> D[Delay guard]
  T --> R[Selected block range]
  W --> R
  G --> R
  D --> R
  R --> B[Fetch blocks]
  B --> M[Build Merkle roots]
  M --> C[Codec artifact]
  C --> Z[Compression]
  Z --> I[Integrity checks]
  I --> L1[Commit to L1]
```

| Stage | Output | Main Risk | Control |
| --- | --- | --- | --- |
| Planning | Batch start/end | Too small, too large, or delayed batch | Smart sizing, max range, urgency guard |
| Rooting | Transaction and withdrawal roots | Incorrect or stale Merkle root | Rust Merkle with fallback/shadow checks |
| Encoding | Canonical batch artifact | Incompatible wire format | Rust batch codec validation |
| Compression | Compressed bytes | Non-reconstructable artifact | Zstd round-trip validation |
| DA | Blob/calldata reference | Missing or mismatched data | DA commitment and verifier path |
| L1 commit | Batch metadata | Invalid continuity or permissions | Sequencer facet checks and monitoring |

## Bridge Lifecycle Detail

### Deposit Path

```mermaid
sequenceDiagram
  autonumber
  participant User
  participant L1Bridge as L1 Bridge Facet
  participant L1Indexer as L1 Listener
  participant Sequencer
  participant L2Bridge as L2 Bridge
  participant L2Indexer as L2 Indexer
  participant API

  User->>L1Bridge: depositETH / depositERC20
  L1Bridge-->>L1Indexer: Deposit event
  L1Indexer->>Sequencer: Persist pending deposit
  Sequencer->>L2Bridge: processDeposit(token, recipient, amount, depositId)
  L2Bridge-->>Sequencer: Deposit processed or replay-protected revert
  Sequencer->>L2Indexer: L2 transaction indexed
  L2Indexer->>API: Bridge context becomes processed
```

### Withdrawal Path

```mermaid
sequenceDiagram
  autonumber
  participant User
  participant L2Bridge as L2 Bridge
  participant Listener as Withdrawal Listener
  participant Batcher as Batch Submitter
  participant L1Bridge as L1 Bridge Facet
  participant Finalizer
  participant API

  User->>L2Bridge: initiateWithdrawal(token, to, amount)
  L2Bridge-->>Listener: WithdrawalInitiated
  Listener->>Batcher: Store withdrawal candidate
  Batcher->>Batcher: Include withdrawal in batch root
  Batcher->>L1Bridge: Queue withdrawal against committed batch
  L1Bridge-->>Finalizer: Withdrawal enters finality window
  Finalizer->>L1Bridge: finalizeWithdrawal after challenge period
  L1Bridge-->>User: Release L1 asset
  API-->>User: Status moves queued -> finalized
```

## Data Availability Modes

```mermaid
flowchart TB
  A[Batch bytes] --> B[Compression]
  B --> C[Codec validation]
  C --> Mode{L1 DA mode}
  Mode --> None[None / legacy mode]
  Mode --> Calldata[Calldata mode]
  Mode --> Blob[Blob mode]
  Calldata --> Small[Small-batch fallback]
  Blob --> Type3[EIP-4844 type-3 transaction]
  Type3 --> Hashes[Blob versioned hashes]
  Hashes --> L1Commit[Commitment stored on L1]
  Small --> L1Commit
  L1Commit --> Verify[Independent verifier reconstruction]
```

| Mode | Intended Use | Production Notes |
| --- | --- | --- |
| None / legacy | Controlled compatibility and migration paths. | Should not be allowed past mandatory DA activation for production batches. |
| Calldata | Small-batch fallback and emergency compatibility. | Expensive and not viable for large batches. |
| Blob | Canonical scalable DA path. | Requires lifecycle tracking, beacon verification, fee monitoring, and mismatch alerts. |

## Indexer And Websocket Recovery

```mermaid
flowchart LR
  L2[L2 blocks] --> L2I[L2 indexer]
  L1[L1 events] --> L1I[L1 indexer]
  L2I --> DB[(PostgreSQL)]
  L1I --> DB
  DB --> REST[REST APIs]
  DB --> WS[Websocket event stream]
  WS --> Consumer[Backend consumer]
  Consumer --> Cursor[Last processed cursor]
  Cursor --> Replay[Replay API: from cursor X to cursor Y]
  Replay --> DB
```

The websocket design assumes consumers persist the last processed cursor. If they disconnect, they can recover the exact missed range through the replay API instead of relying on best-effort live delivery.

## Operational Topology

```mermaid
flowchart TB
  subgraph Edge[Edge And Access]
    lb[Load Balancer]
    rpcproxy[RPC Proxy]
    apiProxy[API Proxy]
  end

  subgraph Nodes[Node Layer]
    rpcA[L2 RPC Node A]
    rpcB[L2 RPC Node B]
    sequencer[Sequencer Host]
  end

  subgraph Data[Data Layer]
    pgPrimary[(PostgreSQL Primary)]
    pgReplica[(PostgreSQL Replica)]
    redis[(Redis)]
  end

  subgraph Observability[Observability]
    logs[Central Logs]
    metrics[Metrics]
    alerts[Alerts]
  end

  lb --> rpcproxy
  lb --> apiProxy
  rpcproxy --> rpcA
  rpcproxy --> rpcB
  apiProxy --> pgReplica
  sequencer --> pgPrimary
  rpcA --> pgPrimary
  rpcB --> pgPrimary
  pgPrimary --> pgReplica
  redis --> apiProxy
  rpcA --> metrics
  rpcB --> metrics
  sequencer --> metrics
  pgPrimary --> metrics
  metrics --> alerts
  logs --> alerts
```

## Trust Boundaries And Controls

| Boundary | Risk | Expected Control |
| --- | --- | --- |
| Public RPC | Unsafe JSON-RPC methods, high-cardinality requests, DoS. | Proxy filtering, safe namespaces, rate limits, monitoring. |
| Sequencer signer | Key compromise, nonce collision, insufficient funding. | Key separation, signer monitoring, replacement policy, restricted env handling. |
| L1 owner/admin | Unsafe upgrade or emergency operation. | Multisig/timelock path, audit trail, runbooks, selector checks. |
| DA commitment | Missing, mismatched, or unverifiable batch data. | Blob hash binding, lifecycle state machine, beacon verification, alerts. |
| Bridge withdrawals | Invalid batch affecting withdrawal finality. | Withdrawal root binding, challenge window, invalidated batch checks. |
| Indexer data | Lost websocket events or stale API responses. | Durable DB, cursor replay, lag metrics, endpoint timing alerts. |

## Production Readiness Focus Areas

| Area | Target |
| --- | --- |
| DA enforcement | Blob DA permanently enabled only after repeated controlled verification and monitoring green state. |
| Independent verification | Batch reconstruction from L1-available data without trusting local artifacts. |
| Fraud proofs | Move from foundation-level dispute wiring toward full deterministic execution and fault-proof VM path. |
| Fee accounting | Shadow accounting for real DA cost versus L2 fee charged, then enforcement in transaction admission. |
| Governance | Multisig/timelock, role separation, deployment checklist, and emergency runbooks. |
| External audit | Contract scope, storage diffs, ABIs, deployment records, test reports, and known limitations documented. |
