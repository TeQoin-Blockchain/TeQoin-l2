# TeQoin Protocol Flows

This document gives reviewers and integrators a visual map of the major TeQoin protocol flows. It is intentionally focused on lifecycle and control flow rather than implementation details.

## 1. L2 Transaction Flow

```mermaid
flowchart LR
  classDef ingress fill:#eff6ff,stroke:#2563eb,color:#0f172a
  classDef exec fill:#ecfdf5,stroke:#059669,color:#0f172a
  classDef observe fill:#f8fafc,stroke:#64748b,color:#0f172a

  A[Wallet signs transaction]:::ingress --> B[Public L2 RPC]:::ingress
  B --> C[L2 mempool / tx pool]:::exec
  C --> D[L2 block execution]:::exec
  D --> E[Receipt and logs]:::exec
  E --> F[L2 indexer]:::observe
  F --> G[REST API / websocket]:::observe
```

## 2. Batch Commitment Flow

```mermaid
flowchart TB
  classDef build fill:#eff6ff,stroke:#2563eb,color:#0f172a
  classDef verify fill:#ecfdf5,stroke:#059669,color:#0f172a
  classDef l1 fill:#fff7ed,stroke:#ea580c,color:#0f172a

  Head[Read canonical L2 head]:::build --> Range[Select batch range]:::build
  Range --> Blocks[Fetch block bodies and receipts]:::build
  Blocks --> Roots[Compute state, tx, and withdrawal roots]:::build
  Roots --> Codec[Encode Rust batch artifact]:::build
  Codec --> Compress[Compress batch payload]:::build
  Compress --> Integrity[Round-trip integrity checks]:::verify
  Integrity --> DA[Publish L1 DA]:::l1
  DA --> Commit[Submit batch commitment]:::l1
  Commit --> Monitor[Index and monitor batch state]:::verify
```

## 3. Blob DA Lifecycle

```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> SIGNED: Blob tx prepared
  SIGNED --> SENT: Broadcast to L1 RPC
  SENT --> MINED: Included in L1 block
  MINED --> CONFIRMED: Confirmation depth reached
  CONFIRMED --> VERIFIED: Blob sidecar and commitment match
  SENT --> FAILED_RETRYABLE: Dropped / underpriced / temporary RPC issue
  MINED --> FAILED_RETRYABLE: Reorg before confirmation
  CONFIRMED --> FAILED_FATAL: Commitment mismatch
  FAILED_RETRYABLE --> SIGNED: Replacement policy
  FAILED_FATAL --> [*]
  VERIFIED --> [*]
```

## 4. Deposit Flow

```mermaid
flowchart LR
  L1User[User on Ethereum L1] --> L1Bridge[Deposit on L1 Bridge]
  L1Bridge --> Event[Deposit Event]
  Event --> L1Listener[L1 Deposit Listener]
  L1Listener --> Queue[Deposit Queue]
  Queue --> Processor[L2 Deposit Processor]
  Processor --> L2Bridge[L2 Bridge processDeposit]
  L2Bridge --> Balance[Recipient credited on L2]
  Balance --> API[Bridge API status: processed]
```

## 5. Withdrawal Flow

```mermaid
flowchart LR
  L2User[User on TeQoin L2] --> L2Bridge[initiateWithdrawal]
  L2Bridge --> Event[Withdrawal Event]
  Event --> Listener[Withdrawal Listener]
  Listener --> Batch[Withdrawal included in batch root]
  Batch --> Queue[L1 queue withdrawal]
  Queue --> Window[Challenge / finality window]
  Window --> Finalize[Finalize on L1]
  Finalize --> Release[Release asset to recipient]
```

## 6. Websocket Recovery Flow

```mermaid
sequenceDiagram
  autonumber
  participant Backend
  participant WS as Websocket Feed
  participant API as Replay API
  participant DB as Event Store

  Backend->>WS: Connect and receive event cursor N
  Backend->>Backend: Persist latest processed cursor
  WS--xBackend: Connection interrupted
  Backend->>WS: Reconnect and observe live cursor M
  Backend->>API: Request missing events from N+1 to M-1
  API->>DB: Load ordered event range
  DB-->>API: Replay events
  API-->>Backend: Recover missed events
  Backend->>Backend: Resume live processing
```

## 7. Fee Accounting Flow

```mermaid
flowchart TB
  L1Fee[L1 base fee and blob fee] --> Oracle[L1 gas/blob fee oracle]
  BatchCost[Observed batch DA cost] --> Shadow[Fee shadow accounting]
  Oracle --> Sequencer[Sequencer fee policy]
  Shadow --> Report[Charged fee vs real DA cost report]
  Sequencer --> Admission[L2 transaction admission policy]
  Report --> Alerts[Undercharge / overcharge alerts]
```

## 8. Security Review Flow

```mermaid
flowchart LR
  Source[Source code] --> CI[CI and security checks]
  CI --> Tests[Unit / integration / contract tests]
  Tests --> Audit[Internal review]
  Audit --> External[External audit package]
  External --> Fixes[Remediation branches]
  Fixes --> Release[Release checklist]
```
