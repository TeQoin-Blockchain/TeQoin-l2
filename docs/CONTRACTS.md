# Smart Contract Map

This document lists the main TeQoin Solidity contract areas and what reviewers should inspect.

## Main Contract Tree

| Path | Purpose |
| --- | --- |
| `sequencer/src/contracts/diamond/Diamond.sol` | Diamond proxy entrypoint. |
| `sequencer/src/contracts/diamond/facets/BridgeFacet.sol` | Active L1 bridge facet for deposits, V3 batch-specific withdrawal queueing, challenge-aware finalization, and invalidated batch checks. |
| `sequencer/src/contracts/diamond/facets/SequencerFacet.sol` | Active L1 batch submission facet with DA policy, blob/calldata commitments, state commitments, and sequencer permissions. |
| `sequencer/src/contracts/diamond/facets/DiamondCutFacet.sol` | Diamond upgrade selector management. |
| `sequencer/src/contracts/diamond/facets/DiamondLoupeFacet.sol` | Diamond introspection. |
| `sequencer/src/contracts/diamond/facets/OwnershipFacet.sol` | Ownership management. |
| `sequencer/src/contracts/diamond/libraries/LibAppStorage.sol` | Shared diamond app storage for bridge, sequencer, DA, and fraud-proof fields. Critical for upgrade safety. |
| `sequencer/src/contracts/diamond/libraries/LibDiamond.sol` | Diamond storage and selector logic. |
| `sequencer/src/contracts/l2/L2BridgeV3.sol` | Latest L2 bridge source with V3 nonce migration and withdrawal rate-limit controls. |
| `sequencer/src/contracts/l2/` | Additional L2 support contracts retained for source reference. |
| `sequencer/src/contracts/fraudproof/` | Fraud-proof foundation contracts: `BondManager`, `ChallengePeriod`, `DisputeGame`, `FaultProofVM`, and `SequencerFacetV3`. |
| `sequencer/src/contracts/mocks/` | Test/mock contracts. Not production deployment targets. |

## High-Risk Review Areas

- Diamond storage layout compatibility across upgrades.
- Selector collisions during diamond cuts.
- Owner powers and upgrade authority.
- Sequencer and relayer/finalizer permissions.
- Legacy submit paths bypassing mandatory DA rules.
- Batch number and L2 block continuity.
- `preStateRoot -> postStateRoot` chaining.
- Withdrawal roots tied to exact batch numbers.
- Invalidated/disputed batch behavior for withdrawals.
- Deposit and withdrawal replay protection.
- ERC-20 pair mapping and token decimal assumptions.
- Emergency pause/migration/drain paths.

## Active Test Coverage

| Path | Purpose |
| --- | --- |
| `sequencer/test/FraudProofAudit.t.sol` | Fraud-proof foundation tests for bonds, challenge periods, dispute outcomes, VM guards, and state commitment checks. |
| `sequencer/test/FraudProofDiamondIntegration.t.sol` | Diamond integration tests for DA policy, blob hash binding, calldata commitments, withdrawal finalization, invalidated batches, and legacy migration boundaries. |

## Deployment / Verification Artifacts

| Path | Purpose |
| --- | --- |
| `abi/BridgeFacetV3.abi.json` | Bridge facet ABI for V3 bridge/finality integration. |
| `abi/SequencerFacetV3.abi.json` | Sequencer facet ABI for V3 state commitment and DA integration. |
| `abi/SequencerFacetStateCommitment.abi.json` | State commitment ABI reference for verifier/indexer integration. |
| `verification/` | Contract verification and deployment metadata when included in the operational checkout. |

## Audit Notes

Before any mainnet deployment, auditors should receive:

- Full source tree for tracked contracts.
- Exact deployed addresses and chain IDs.
- Diamond cut history.
- Storage layout diff for every upgrade.
- ABI files for active facets/contracts.
- Deployment scripts and environment variable names, with secrets redacted.
- Foundry test suite and reproduction commands.
- Known limitations around full EVM fault-proof completeness.

## Source Scope Notes

This repository intentionally tracks active protocol source files and integration ABIs. Runtime deployment artifacts, local backups, generated Foundry outputs, private environment files, and obsolete experimental contract drafts are excluded from version control.

Current source sync intentionally excludes the standalone faucet contract, L1 gas oracle contract, and `L2BridgeV2.sol` because they are not part of the latest requested protocol-source package for this branch.
