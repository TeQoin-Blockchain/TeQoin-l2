# Smart Contract Map

This document lists the main TeQoin Solidity contract areas and what reviewers should inspect.

## Main Contract Tree

| Path | Purpose |
| --- | --- |
| `sequencer/src/contracts/diamond/Diamond.sol` | Diamond proxy entrypoint. |
| `sequencer/src/contracts/diamond/facets/BridgeFacet.sol` | L1 bridge deposit/withdrawal lifecycle and withdrawal queue/finality behavior. |
| `sequencer/src/contracts/diamond/facets/SequencerFacet.sol` | State batch submission, batch metadata, DA commitments, sequencer permissions. |
| `sequencer/src/contracts/diamond/facets/DiamondCutFacet.sol` | Diamond upgrade selector management. |
| `sequencer/src/contracts/diamond/facets/DiamondLoupeFacet.sol` | Diamond introspection. |
| `sequencer/src/contracts/diamond/facets/OwnershipFacet.sol` | Ownership management. |
| `sequencer/src/contracts/diamond/libraries/LibAppStorage.sol` | Shared diamond app storage. Critical for upgrade safety. |
| `sequencer/src/contracts/diamond/libraries/LibDiamond.sol` | Diamond storage and selector logic. |
| `sequencer/src/contracts/l2/` | L2 bridge, token, faucet, gas oracle, staking, and related contracts. |
| `sequencer/src/contracts/fraudproof/` | Fraud-proof foundation contracts and dispute components when included. |
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

## Deployment / Verification Artifacts

| Path | Purpose |
| --- | --- |
| `abi/` | Exported ABI files used by frontend/backend/indexer integrations. |
| `verification/` | Contract verification and deployment metadata where available. |
| `faucet/` | Faucet ABI and deployment notes. |
| `fraudproof_deployment_*.json` | Fraud-proof deployment metadata where present. |

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
