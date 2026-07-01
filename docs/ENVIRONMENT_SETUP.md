# Environment Setup

## Required tools

- Node.js 20+
- npm 10+
- Rust stable toolchain
- Foundry
- Docker, for local service/container checks when needed
- PostgreSQL client tools if running migrations locally

## Install dependencies

```bash
npm ci --prefix sequencer
npm ci --prefix l2-indexer
npm ci --prefix sepolia-indexer
npm ci --prefix teqoin-core
```

## Rust setup

```bash
cd teqoin-core
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Solidity setup

```bash
cd sequencer
forge test
```

Foundry uses `sequencer/foundry.toml` and OpenZeppelin from `sequencer/node_modules`.

## Environment variables

Use `.env.example` or service-specific templates. Do not commit real `.env` files.

Secrets must come from:

- local root-only env files for private testnet operations, or
- GitHub Secrets / environment secrets for CI/CD, or
- a production secret manager before mainnet.
