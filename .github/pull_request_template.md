## Summary

Describe the change and why it is needed.

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] Hotfix
- [ ] Refactor
- [ ] Test-only
- [ ] Documentation
- [ ] DevOps/CI
- [ ] Security hardening

## Risk area

- [ ] Smart contracts / Diamond storage / selectors
- [ ] Bridge deposits or withdrawals
- [ ] Batch submission / Blob DA / calldata DA
- [ ] Fraud-proof / challenger / verifier
- [ ] Fee oracle / fee accounting
- [ ] Signers / nonces / L1 tx replacement
- [ ] Indexer/API/websocket
- [ ] Infrastructure/secrets/deployment
- [ ] Low-risk docs or tooling only

## Validation

Commands run:

```text
# paste commands and results here
```

## Security checklist

- [ ] No `.env`, private keys, mnemonic phrases, wallet files, API keys, certificates, database dumps, node data, or logs are included.
- [ ] I reviewed staged files before commit.
- [ ] Any new config uses examples/templates, not real secrets.
- [ ] Any new deployment behavior is manual or protected.

## Contract/protocol checklist

- [ ] Not applicable.
- [ ] Storage layout impact reviewed.
- [ ] Selector collisions checked.
- [ ] Access control reviewed.
- [ ] Replay/finality/challenge assumptions documented.
- [ ] ABI/deployment docs updated if needed.

## Operational impact

Mention service restarts, migrations, env var changes, signer funding, monitoring, or manual steps required.
