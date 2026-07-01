# Security Policy

## Supported status

TeQoin is currently a testnet/protocol-hardening project. Mainnet production status requires additional audit, monitoring, multisig/timelock setup, and full production-readiness signoff.

## Reporting vulnerabilities

Please do not open public GitHub issues for exploitable vulnerabilities.

Report security issues privately to the TeQoin security contact. Include:

- affected component or contract
- impact summary
- reproduction steps
- transaction hashes or logs if relevant
- suggested severity
- whether funds, keys, bridge accounting, DA, batch finality, or withdrawals are affected

## High-priority areas

- L1 Diamond and selector/storage safety
- Bridge deposit and withdrawal accounting
- Withdrawal replay/finality/challenge logic
- Batch commitments, Blob DA, and DA enforcement
- Sequencer signer separation, nonce handling, and transaction replacement
- Fraud-proof foundation and dispute/bond accounting
- L1 gas/blob fee oracle and fee accounting
- RPC, websocket, indexer, and backend recovery behavior
- Secrets, service files, Docker, firewall, and host security

## Secret handling

Never share private keys or mnemonic phrases in issues, PRs, logs, screenshots, or audit bundles. Rotate any secret that may have been exposed.

## Mainnet requirement

Before mainnet, TeQoin should have:

- external smart-contract/protocol audit
- remediation review
- multisig/timelock for owner powers
- documented emergency process
- monitoring and alerting
- secret-management plan
- production incident runbooks
