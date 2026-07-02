<p align="center">
  <img src="docs/assets/teqoin.jpg" alt="TeQoin" width="180" />
</p>

<h1 align="center">TeQoin L2</h1>

<p align="center">
  Ethereum-aligned Layer 2 infrastructure for fast execution, low-cost transactions, secure bridging, indexing, and scalable data availability.
</p>

<p align="center">
  <a href="https://github.com/0xakileet/TeQoin-l2/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/0xakileet/TeQoin-l2/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/0xakileet/TeQoin-l2/actions/workflows/security.yml"><img alt="Security" src="https://github.com/0xakileet/TeQoin-l2/actions/workflows/security.yml/badge.svg" /></a>
</p>

---

## Overview

TeQoin L2 is an EVM-compatible Layer 2 blockchain stack designed for high-throughput execution, efficient settlement, cross-layer bridging, reliable indexing, and modern Ethereum data availability.

The project combines a TeQoin L2 execution node, sequencer services, L1/L2 bridge contracts, indexer APIs, Rust-native cryptographic primitives, batch compression, Blob DA support, and a growing fraud-proof verification stack.

## Highlights

| Area | Capability |
| --- | --- |
| EVM compatibility | Ethereum-style JSON-RPC, accounts, contracts, transactions, and tooling. |
| Fast execution | Short L2 block time for responsive user experience. |
| Low-cost transactions | L2 execution and batching reduce user-facing cost compared with direct L1 activity. |
| Secure bridge architecture | L1/L2 bridge lifecycle for deposits, withdrawals, and settlement tracking. |
| Ethereum data availability | Blob DA and calldata DA paths for L1-available batch data. |
| Rust core | Merkle, batch codec, compression, crypto, and transaction-manager foundations. |
| Indexer APIs | Explorer/backend APIs for blocks, transactions, addresses, bridge history, faucet activity, metrics, and websocket replay. |
| Production workflow | CI, security scanning, branch discipline, release checklists, and audit-ready documentation. |

## Architecture

```text
Ethereum L1
    |
    | bridge messages, state commitments, DA references
    v
+----------------------+        +----------------------+
| L1 Diamond Contracts | <----> | Sequencer Services   |
| Bridge / Sequencer   |        | Batch / DA / Relayer |
+----------------------+        +----------------------+
        |                               |
        | commitments                   | execution / blocks
        v                               v
+----------------------+        +----------------------+
| Blob / Calldata DA   |        | TeQoin L2 Node       |
| Verification Path    |        | EVM-compatible RPC   |
+----------------------+        +----------------------+
        |                               |
        | proofs / artifacts            | indexed data
        v                               v
+----------------------+        +----------------------+
| Rust Core            |        | L2 / L1 Indexers     |
| Merkle / Codec / Zstd|        | APIs / Websocket     |
+----------------------+        +----------------------+
```

## Repository Map

| Path | Purpose |
| --- | --- |
| `sequencer/` | TypeScript sequencer, L1/L2 bridge services, batch submission, DA/blob services, Solidity contracts, scripts, and tests. |
| `sequencer/src/contracts/` | Solidity contracts, including Diamond facets, bridge contracts, L2 contracts, faucet, oracle, and fraud-proof components. |
| `l2-indexer/` | TeQoin L2 indexer/API for blocks, transactions, bridges, faucet events, websocket replay, metrics, and explorer data. |
| `sepolia-indexer/` | Sepolia/L1 indexer API and bridge-side transaction history when included in the full engineering checkout. |
| `teqoin-core/` | Rust native crates for Merkle, batch codec, compression, crypto signatures, L1 transaction manager, and FFI foundations. |
| `teqoin-geth/` | TeQoin L2 geth implementation/build tree when included in the full engineering checkout. |
| `abi/` | Exported ABI files for frontend/backend integrations and contract verification. |
| `faucet/` | Faucet ABI, deployment notes, and integration references. |
| `fraudproof/` | Fraud-proof design and verification components when included in the full engineering checkout. |
| `fraudproof-evidence/` | Evidence-builder and verifier artifacts for fraud-proof research paths. |
| `verification/` | Contract verification metadata and deployment verification artifacts. |
| `docs/` | Architecture, contracts, audit scope, release, production readiness, branch model, and GitHub settings documentation. |
| `.github/` | Pull request templates, issue templates, CI, security, and manual deployment workflows. |

## Core Components

### Sequencer

The sequencer coordinates L2 block production, L1 deposit processing, withdrawal listening/finalization, state batch submission, DA commitment handling, fee oracle updates, signer management, and operational monitoring.

Key areas:

- `sequencer/src/services/batch-submitter.service.ts`
- `sequencer/src/services/l1-listener.service.ts`
- `sequencer/src/services/l2-processor.service.ts`
- `sequencer/src/services/withdrawal-finalizer.service.ts`
- `sequencer/src/services/l1-blob-da.service.ts`
- `sequencer/src/services/l1-signer-coordinator.service.ts`

### Solidity Contracts

The active contract tree lives under `sequencer/src/contracts`. The L1 architecture uses Diamond-style contracts and dedicated facets for bridge/sequencer behavior. L2 contracts cover bridge, faucet, oracle, token, and fraud-proof support flows.

Key areas:

- `sequencer/src/contracts/diamond/`
- `sequencer/src/contracts/diamond/facets/BridgeFacet.sol`
- `sequencer/src/contracts/diamond/facets/SequencerFacet.sol`
- `sequencer/src/contracts/diamond/libraries/LibAppStorage.sol`
- `sequencer/src/contracts/l2/`
- `sequencer/src/contracts/fraudproof/`

### Rust Core

Rust is used for deterministic and performance-sensitive primitives:

- Merkle tree and proof generation
- Batch codec and wire integrity
- Compression/decompression
- Crypto helpers
- L1 transaction manager foundations

### Indexers and APIs

The indexer stack supports explorer, backend, and websocket recovery flows:

- Latest blocks and transactions
- Address history
- Bridge lifecycle data
- Faucet claims
- Metrics and stats
- Websocket events with cursor/replay recovery

## Branching Model

| Branch | Purpose |
| --- | --- |
| `main` | Stable production-ready branch. |
| `develop` | Integration branch for reviewed work. |
| `test` | Testnet/staging validation branch. |
| `feature/*` | New protocol/service features. |
| `fix/*` | Bug fixes. |
| `hotfix/*` | Urgent production fixes. |
| `release/*` | Release preparation. |
| `docs/*` | Documentation-only changes. |
| `chore/*` | CI, repository, dependency, and maintenance changes. |

All meaningful changes should land through pull requests with CI and security checks passing.

## Local Verification

```bash
./scripts/check-repo-hygiene.sh
npm ci --prefix sequencer && npm run build --prefix sequencer
npm ci --prefix l2-indexer && npm run build --prefix l2-indexer
cd teqoin-core && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd sequencer && forge test
```

Some directories are optional depending on the checkout. CI skips optional Rust/Foundry/Docker checks when the corresponding project files are not present.

## Security

- Secrets must never be committed.
- Real `.env`, wallet, private-key, keystore, certificate, and cloud credential files are ignored.
- GitHub security workflows run secret scanning, dependency review where supported, npm audit, and cargo audit.
- Deployment workflows are manual and guarded.

## Documentation

Start here:

- `CONTRIBUTING.md`
- `SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTRACTS.md`
- `docs/AUDIT_SCOPE.md`
- `docs/SECURITY_REVIEW_GUIDE.md`
- `docs/BRANCHING_STRATEGY.md`
- `docs/DEVELOPMENT_CHECKLIST.md`
- `docs/ENVIRONMENT_SETUP.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/PRODUCTION_READINESS_CHECKLIST.md`
- `docs/GITHUB_REPOSITORY_SETTINGS.md`
- `docs/ROADMAP.md`
