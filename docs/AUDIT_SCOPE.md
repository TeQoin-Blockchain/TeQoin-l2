# TeQoin Audit Scope

This document is intended for external security firms reviewing TeQoin L2.

## Primary Review Goals

- Verify Diamond upgrade safety and storage layout correctness.
- Review L1 bridge custody, deposits, withdrawals, challenge/finality behavior, and replay protection.
- Review SequencerFacet batch submission, DA commitment enforcement, batch continuity, and legacy-path bypass risks.
- Review Blob DA binding and independent reconstruction assumptions.
- Review fraud-proof foundation and identify what remains before a full EVM fault-proof VM claim.
- Review sequencer/indexer/backend operational security assumptions.

## In-Scope Code Areas

| Area | Path |
| --- | --- |
| L1 diamond contracts | `sequencer/src/contracts/diamond/` |
| L1 bridge/sequencer facets | `sequencer/src/contracts/diamond/facets/` |
| Shared diamond storage | `sequencer/src/contracts/diamond/libraries/LibAppStorage.sol` |
| L2 contracts | `sequencer/src/contracts/l2/` |
| Fraud-proof foundation | `sequencer/src/contracts/fraudproof/`, `fraudproof/` |
| Sequencer runtime | `sequencer/src/services/` |
| Blob DA / artifact services | `sequencer/src/services/l1-blob-da.service.ts`, `sequencer/src/services/batch-artifact-store.service.ts` |
| Rust core | `teqoin-core/` |
| Indexers/API/websocket | `l2-indexer/`, `sepolia-indexer/` |
| CI/security/release workflow | `.github/`, `docs/`, `scripts/check-repo-hygiene.sh` |

## Out-of-Scope Unless Requested

- Frontend applications.
- Third-party infrastructure providers.
- Economic/tokenomics audit.
- Full mainnet launch approval without a separate infra/key-management review.

## Known Limitations

TeQoin does not yet claim complete Cannon-style full EVM fault-proof security. The current fraud-proof work is foundation-level and should be reviewed as such.

Current production blockers include:

- Full EVM fault-proof VM path.
- Independent L1-first verifier maturity.
- Mainnet multisig/timelock governance.
- Permanent Blob DA activation criteria.
- Final external audit and remediation cycle.

## Expected Reviewer Deliverables

- Critical/high/medium/low findings.
- Storage layout and selector collision assessment.
- Access-control matrix assessment.
- Bridge custody and withdrawal/finality assessment.
- DA/batch commitment correctness assessment.
- Fraud-proof gap analysis.
- Operational security recommendations.
- Test coverage recommendations.
