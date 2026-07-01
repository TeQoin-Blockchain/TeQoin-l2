<p align="center">
  <img src="docs/assets/teqoin.jpg" alt="TeQoin" width="180" />
</p>

<h1 align="center">TeQoin L2</h1>

<p align="center">
  Modular Ethereum-aligned Layer 2 infrastructure for high-throughput execution, bridging, indexing, Blob DA experiments, and fraud-proof production hardening.
</p>

<p align="center">
  <a href="https://github.com/0xakileet/TeQoin-l2/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/0xakileet/TeQoin-l2/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/0xakileet/TeQoin-l2/actions/workflows/security.yml"><img alt="Security" src="https://github.com/0xakileet/TeQoin-l2/actions/workflows/security.yml/badge.svg" /></a>
</p>

---

## Overview

TeQoin L2 is a testnet-stage rollup-style blockchain stack built around an EVM-compatible L2 execution layer, L1 bridge contracts, sequencer services, indexers, Rust-native proof/codec primitives, and production hardening work for Blob DA and fraud-proof verification.

The repository is organized for protocol engineering, infrastructure operations, and external security review. It separates runtime services, Solidity contracts, Rust core crates, indexers, deployment workflows, and audit documentation.

## Current Status

| Area | Status |
| --- | --- |
| L2 execution / RPC | Testnet operational; production hardening ongoing. |
| Sequencer services | Active TypeScript service stack for batches, deposits, withdrawals, DA, signers, and monitoring. |
| Bridge | L1/L2 bridge flow exists; fraud-proof and finality protections are being hardened. |
| Blob DA | Controlled Sepolia blob tests verified; permanent activation remains gated by monitoring and funding. |
| Fraud proofs | Foundation-level contracts and monitors exist; full Cannon-style EVM fault-proof VM is not complete yet. |
| Rust core | Merkle, batch codec, compression, crypto, and L1 tx manager foundations. |
| Indexers | L2 and Sepolia indexers support explorer/backend APIs and websocket recovery flows. |
| Production readiness | CI, security scanning, protected branches, release checklists, and audit scope docs are in place. |

## Architecture

```text
Ethereum Sepolia / L1
        |
        | deposits, withdrawals, batches, DA commitments
        v
+----------------------+        +----------------------+
| L1 Diamond Contracts | <----> | Sequencer Services   |
| Bridge / Sequencer   |        | Batch / DA / Relayer |
+----------------------+        +----------------------+
        |                               |
        | commitments                   | execution / blocks
        v                               v
+----------------------+        +----------------------+
| Blob / Calldata DA   |        | TeQoin L2 Geth       |
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
| `sequencer/src/contracts/` | Solidity contracts, including Diamond facets, bridge contracts, L2 contracts, faucet, oracle, and fraud-proof additions where tracked. |
| `l2-indexer/` | TeQoin L2 indexer/API for blocks, transactions, bridges, faucet events, websocket replay, metrics, and explorer data. |
| `sepolia-indexer/` | Sepolia/L1 indexer API and bridge-side transaction history when included in the full engineering checkout. |
| `teqoin-core/` | Rust native crates for Merkle, batch codec, compression, crypto signatures, L1 transaction manager, and FFI foundations. |
| `teqoin-geth/` | TeQoin L2 geth implementation/build tree when included in the full engineering checkout. |
| `abi/` | Exported ABI files for frontend/backend integrations and contract verification. |
| `faucet/` | Faucet ABI, deployment notes, and frontend/backend integration references. |
| `fraudproof/` | Fraud-proof design/prototype contracts and storage additions when included in the full audit checkout. |
| `fraudproof-evidence/` | Evidence-builder and verifier artifacts for fraud-proof research paths. |
| `verification/` | Contract verification metadata and deployment verification artifacts. |
| `docs/` | Engineering workflow, release, production readiness, branch model, and GitHub settings documentation. |
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

## Security Posture

- Secrets must never be committed.
- Real `.env`, wallet, private-key, keystore, certificate, and cloud credential files are ignored.
- Branch protection is enabled for `main`, `develop`, and `test`.
- GitHub security workflows run secret scanning, dependency review, npm audit, and cargo audit.
- Production deployment is manual and intentionally guarded until deployment scripts, rollback procedures, and external audit requirements are finalized.

## Documentation

Start here:

- `CONTRIBUTING.md`
- `SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTRACTS.md`
- `docs/BRANCHING_STRATEGY.md`
- `docs/DEVELOPMENT_CHECKLIST.md`
- `docs/ENVIRONMENT_SETUP.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/PRODUCTION_READINESS_CHECKLIST.md`
- `docs/GITHUB_REPOSITORY_SETTINGS.md`
- `docs/ROADMAP.md`

## Production Readiness Note

TeQoin is moving from testnet/MVP engineering into production hardening. The project has working infrastructure and verified controlled Blob DA paths, but it should not be represented as a complete mainnet-grade fault-proof rollup until the independent L1-first verifier, full fault-proof VM path, governance controls, monitoring, and external audits are complete.
