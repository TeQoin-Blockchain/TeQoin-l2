# TeQoin L2 Node / Sequencer Server

This server hosts the TeQoin testnet L2 execution node, sequencer services, L2 indexer APIs, Sepolia indexer APIs, fraud-proof monitoring services, and supporting infrastructure.

## Main Project Directories

| Path | Purpose |
| --- | --- |
| `/data/TeQoin/sequencer` | TypeScript sequencer services, L1 batch submission, deposits, withdrawals, DA/blob logic, Solidity contracts, deployment scripts. |
| `/data/TeQoin/l2-indexer` | TeQoin L2 block/transaction/bridge/event indexer and public API. |
| `/data/TeQoin/sepolia-indexer` | Sepolia-side indexer for bridge and L1 transaction visibility. |
| `/data/TeQoin/teqoin-core` | Rust core crates: Merkle, batch codec, compression, crypto, L1 tx manager foundations. |
| `/data/TeQoin/teqoin-geth` | Custom L2 geth implementation/build tree. |
| `/data/TeQoin/fraudproof` | Fraud-proof contract prototypes and design work. |
| `/data/TeQoin/abi` | Current exported ABI files. |
| `/data/TeQoin/batch-artifact-store` | Local batch artifact/DA records for controlled testing and verification. |
| `/data/TeQoin/verification` | Verification/deployment artifacts. |

## Important Runtime Services

| Service | Purpose |
| --- | --- |
| `teqoin-sequencer.service` | Main sequencer manager. |
| `teqoin-l2-indexer.service` | Public L2 indexer API and sync worker. |
| `teqoin-sepolia-indexer.service` | Sepolia indexer API and sync worker. |
| `teqoin-event-gateway.service` | Backend websocket/event gateway. |
| `teqoin-rpc-filter.service` | Public RPC filter/proxy guard. |
| `teqoin-fraudproof-overwatch.service` | Fraud-proof / commitment monitoring. |
| `teqoin-fraudproof-shadow-verifier.service` | Shadow verifier for fraud-proof/DA path. |
| `sepolia-geth.service` | Sepolia execution node container. |
| `sepolia-lighthouse.service` | Sepolia beacon node container. |
| `teqoin-disk-guard.timer` | Disk/log/storage guardrail monitor. |

Useful checks:

```bash
systemctl status teqoin-sequencer.service
systemctl status teqoin-l2-indexer.service
systemctl status teqoin-sepolia-indexer.service
systemctl status teqoin-event-gateway.service
systemctl status teqoin-fraudproof-overwatch.service
systemctl status teqoin-fraudproof-shadow-verifier.service
systemctl status sepolia-geth.service
systemctl status sepolia-lighthouse.service
systemctl status teqoin-disk-guard.timer
```

## Docker Containers

Current key containers:

| Container | Purpose |
| --- | --- |
| `l2-geth` | TeQoin L2 execution/RPC node. |
| `l2-postgres` | Shared Postgres for sequencer/indexers. |
| `l2-redis` | Redis cache/state helper. |
| `l2-rpc-proxy` | Public HTTP/HTTPS proxy. |
| `sepolia-geth` | Sepolia execution node. |
| `sepolia-lighthouse` | Sepolia beacon node. |

Useful checks:

```bash
docker ps
docker inspect l2-geth --format '{{json .HostConfig.LogConfig}}'
df -h / /data/ethereum/sepolia-new
sudo tail -50 /var/log/teqoin-disk-guard.log
```

## Main APIs

| URL | Purpose |
| --- | --- |
| `https://api.teqoin.io/api/v1/status` | Public L2 indexer status. |
| `https://api.teqoin.io/api/v1/stats` | L2 explorer stats. |
| `https://api.teqoin.io/api/v1/transaction/latest?limit=5` | Latest L2 transactions. |
| `https://api.teqoin.io/api/v1/block/recent?limit=5` | Recent L2 blocks. |
| `http://127.0.0.1:3002/api/v1/transaction/latest?limit=5` | Local Sepolia indexer latest transactions. |

## Security Notes For Auditors

- Real `.env` files and wallet/private-key text files are intentionally root-only (`0600`).
- Redacted env key lists are available as `.env.example.redacted` in each app directory.
- Docker log rotation is enabled globally and on running containers.
- Journald and syslog retention limits are configured.
- The Sepolia indexer intentionally avoids huge full-chain ERC20 topic indexes to prevent disk exhaustion; this is a known storage architecture tradeoff.
- Fraud-proof and Blob DA work is partially production-hardened but still under active development; see the production-readiness docs below.


## Engineering Workflow

This repository now follows a protected-branch workflow suitable for infrastructure work:

- `main` is the stable release branch.
- `develop` is the integration branch.
- `feature/*`, `fix/*`, `hotfix/*`, and `release/*` branches are used for normal development.

Start here for contribution and release process:

- `CONTRIBUTING.md`
- `docs/BRANCHING_STRATEGY.md`
- `docs/DEVELOPMENT_CHECKLIST.md`
- `docs/ENVIRONMENT_SETUP.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/PRODUCTION_READINESS_CHECKLIST.md`
- `docs/GITHUB_REPOSITORY_SETTINGS.md`

## Local Verification

Run the repository hygiene check before staging or committing:

```bash
./scripts/check-repo-hygiene.sh
```

Core build/test checks:

```bash
npm ci --prefix sequencer && npm run build --prefix sequencer
npm ci --prefix l2-indexer && npm run build --prefix l2-indexer
npm ci --prefix sepolia-indexer && npm run build --prefix sepolia-indexer
cd teqoin-core && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd sequencer && forge test
```

## GitHub CI/CD

GitHub Actions are defined under `.github/workflows`:

- `ci.yml` runs repository hygiene, TypeScript builds, Rust checks, Foundry tests, and Docker build checks.
- `security.yml` runs secret/dependency/security checks.
- `cd.yml` is a manual deployment guardrail workflow. It validates builds but intentionally does not deploy automatically until deployment scripts, secrets, approvals, and rollback procedures are audited.
