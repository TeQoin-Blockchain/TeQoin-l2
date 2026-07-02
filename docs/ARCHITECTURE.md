# TeQoin Architecture

This document maps the TeQoin L2 system for protocol engineers, infrastructure partners, auditors, backend developers, and frontend integrators.

## System Overview

```mermaid
flowchart TB
  subgraph Users[User Layer]
    wallet[Wallets]
    apps[Applications]
    backend[Backend Services]
  end

  subgraph Public[Public Access Layer]
    rpc[Public L2 RPC]
    api[L2 Indexer API]
    ws[Websocket Gateway]
  end

  subgraph L2[L2 Layer]
    geth[TeQoin L2 Execution Node]
    sequencer[Sequencer Manager]
    processor[L2 Deposit Processor]
    withdrawal[L2 Withdrawal Listener]
  end

  subgraph Core[Native Core]
    merkle[Rust Merkle]
    codec[Rust Batch Codec]
    compression[Rust Compression]
    txmgr[L1 Tx Manager]
  end

  subgraph L1[Ethereum L1 Layer]
    diamond[L1 Diamond]
    bridge[Bridge Facet]
    seqfacet[Sequencer Facet]
    da[Blob / Calldata DA]
  end

  subgraph Data[Data Services]
    postgres[(PostgreSQL)]
    redis[(Redis)]
    l2indexer[L2 Indexer]
    l1indexer[L1 Indexer]
  end

  wallet --> rpc
  apps --> api
  backend --> ws
  rpc --> geth
  geth --> sequencer
  sequencer --> processor
  sequencer --> withdrawal
  sequencer --> merkle
  sequencer --> codec
  sequencer --> compression
  sequencer --> txmgr
  txmgr --> diamond
  txmgr --> da
  diamond --> bridge
  diamond --> seqfacet
  geth --> l2indexer
  diamond --> l1indexer
  l2indexer --> postgres
  l1indexer --> postgres
  api --> postgres
  ws --> postgres
  api --> redis
```

## Layer Responsibilities

| Layer | Responsibility | Main Code Areas |
| --- | --- | --- |
| Public access | RPC, API, websocket, frontend/backend integration. | `l2-indexer`, `sepolia-indexer`, RPC proxy config |
| L2 execution | EVM-compatible block execution and state. | `teqoin-geth`, L2 runtime config |
| Sequencer | Batch planning, deposits, withdrawals, DA, signers, fee oracle, monitoring. | `sequencer/src/services` |
| L1 contracts | Bridge custody, batch commitments, DA references, finality and dispute foundations. | `sequencer/src/contracts/diamond` |
| Rust core | Deterministic Merkle, codec, compression, crypto, and L1 tx manager primitives. | `teqoin-core` |
| Indexing | Explorer APIs, bridge lifecycle, metrics, websocket replay, analytics. | `l2-indexer`, `sepolia-indexer` |
| Operations | Docker/systemd/nginx/Postgres/Redis/logging/alerts. | deployment config and runbooks |

## Transaction Lifecycle

```mermaid
sequenceDiagram
  participant User
  participant RPC as Public L2 RPC
  participant L2 as TeQoin L2 Node
  participant Seq as Sequencer
  participant Core as Rust Core
  participant L1 as L1 Contracts
  participant Idx as Indexers

  User->>RPC: Submit raw transaction
  RPC->>L2: Broadcast to execution node
  L2->>L2: Execute and include in L2 block
  L2-->>Seq: Expose canonical head and block data
  Seq->>Core: Build roots, codec artifact, compression
  Seq->>L1: Submit batch commitment / DA reference
  L1-->>Seq: Confirm commitment
  L2-->>Idx: Indexed L2 block and tx data
  L1-->>Idx: Indexed L1 settlement events
  Idx-->>User: Explorer/API/websocket response
```

## Batch Lifecycle

```mermaid
flowchart LR
  A[Observe L2 head] --> B[Select batch boundary]
  B --> C[Fetch L2 blocks]
  C --> D[Build transaction and withdrawal roots]
  D --> E[Encode batch artifact]
  E --> F[Compress batch data]
  F --> G[Publish DA reference]
  G --> H[Submit L1 batch commitment]
  H --> I[Queue withdrawals]
  I --> J[Index and monitor lifecycle]
```

Batch selection is boundary-based and uses smart sizing inputs. The base boundary is `BATCH_SIZE`, while catch-up can select larger ranges rounded to the boundary.

| Input | Purpose |
| --- | --- |
| `BATCH_SIZE` | Base L2 block boundary. |
| `BATCH_CATCHUP_MAX_BLOCK_STEP` | Maximum catch-up range. |
| `SMART_BATCH_MAX_TX_COUNT` | Transaction-count pressure guard. |
| `SMART_BATCH_MAX_WIRE_BYTES` | Encoded/compressed data-size guard. |
| `SMART_BATCH_MAX_DELAY_BLOCKS` | Maximum delay before submitting. |
| urgent withdrawal threshold | Prevents withdrawal backlog from waiting too long. |

## Bridge Lifecycle

### L1 to L2 Deposit

```mermaid
sequenceDiagram
  participant User
  participant L1Bridge as L1 Bridge
  participant Listener as L1 Listener
  participant Sequencer
  participant L2Bridge as L2 Bridge
  participant Indexer

  User->>L1Bridge: Deposit ETH / ERC-20
  L1Bridge-->>Listener: Deposit event
  Listener->>Sequencer: Persist deposit record
  Sequencer->>L2Bridge: Process deposit
  L2Bridge-->>User: Credit ETH / mint mapped token
  Indexer->>Indexer: Record bridge context
```

### L2 to L1 Withdrawal

```mermaid
sequenceDiagram
  participant User
  participant L2Bridge as L2 Bridge
  participant Listener as Withdrawal Listener
  participant Batch as Batch Submitter
  participant L1Bridge as L1 Bridge
  participant Finalizer

  User->>L2Bridge: Initiate withdrawal
  L2Bridge-->>Listener: Withdrawal event
  Listener->>Batch: Store withdrawal for batch root
  Batch->>L1Bridge: Commit batch and queue withdrawal
  L1Bridge-->>Finalizer: Finalizable after challenge window
  Finalizer->>L1Bridge: Finalize withdrawal
  L1Bridge-->>User: Release funds
```

## Data Availability Flow

```mermaid
flowchart TB
  batch[Batch bytes] --> compress[Zstd compression]
  compress --> codec[Rust batch codec]
  codec --> da{DA mode}
  da --> blob[Ethereum blob transaction]
  da --> calldata[Ethereum calldata fallback]
  blob --> commit[L1 DA commitment]
  calldata --> commit
  commit --> verifier[L1-first verifier]
  verifier --> roots[Verify tx root, withdrawal root, range, and state roots]
```

R2/S3-style object storage is not canonical DA. Canonical data availability is designed around Ethereum L1-available data.

## Indexer And Websocket Flow

```mermaid
flowchart LR
  l2[L2 Node] --> blockListener[Block Listener]
  l1[L1 Contracts] --> bridgeListener[Bridge Listener]
  blockListener --> db[(PostgreSQL)]
  bridgeListener --> db
  db --> api[REST API]
  db --> ws[Websocket Gateway]
  ws --> consumer[Backend Consumer]
  consumer --> replay[Replay API by Cursor]
  replay --> db
```

## Trust Boundaries

| Boundary | Control |
| --- | --- |
| Public RPC | Safe namespaces, rate limits, proxy controls. |
| Sequencer signer | Key separation, funding monitoring, nonce/replacement handling. |
| L1 owner/admin | Intended for multisig/timelock governance before production launch. |
| DA commitment | Blob/calldata reference and verifier path. |
| Indexer/API | Replayable data, DB indexes, monitoring, rate limits. |
| Websocket consumers | Durable cursor and replay API. |

## Operational Topology

```mermaid
flowchart TB
  lb[Load Balancer / RPC Gateway]
  rpc1[RPC Node A]
  rpc2[RPC Node B]
  indexer[Indexers]
  db[(PostgreSQL)]
  redis[(Redis)]
  monitor[Monitoring]

  lb --> rpc1
  lb --> rpc2
  rpc1 --> monitor
  rpc2 --> monitor
  rpc1 --> indexer
  rpc2 --> indexer
  indexer --> db
  indexer --> redis
  db --> monitor
  redis --> monitor
```

For public mainnet operation, RPC, indexer, database, and sequencer roles should be separated as traffic grows.
