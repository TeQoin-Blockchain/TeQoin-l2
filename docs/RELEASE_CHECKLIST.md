# Release Checklist

## Before release branch

- [ ] Scope frozen.
- [ ] All critical/high bugs triaged.
- [ ] Storage layout changes documented.
- [ ] ABI changes documented.
- [ ] Migration scripts reviewed.
- [ ] DA/blob/batch behavior documented.
- [ ] Monitoring changes documented.

## Release branch validation

- [ ] CI passes on `release/*`.
- [ ] TypeScript services build.
- [ ] Rust format/clippy/tests pass.
- [ ] Foundry tests pass.
- [ ] Secret scan passes.
- [ ] Docker build checks pass where applicable.
- [ ] Manual testnet smoke test completed.
- [ ] Rollback plan written.

## Production/mainnet release gate

- [ ] External audit/remediation completed where required.
- [ ] Multisig/timelock configured for owner powers.
- [ ] GitHub environment requires approval for deployment.
- [ ] Signer balances and alerts green.
- [ ] RPC/API/indexer health green.
- [ ] Incident contacts and emergency runbook confirmed.
- [ ] Tag created and release notes published.
