-- Core tables for L2 indexer

CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocks (
  number BIGINT PRIMARY KEY,
  hash VARCHAR(66) NOT NULL UNIQUE,
  parent_hash VARCHAR(66) NOT NULL,
  timestamp BIGINT NOT NULL,
  miner VARCHAR(42) NOT NULL,
  gas_used NUMERIC(78, 0) NOT NULL,
  gas_limit NUMERIC(78, 0) NOT NULL,
  transaction_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  hash VARCHAR(66) PRIMARY KEY,
  block_number BIGINT NOT NULL REFERENCES blocks(number) ON DELETE CASCADE,
  transaction_index INTEGER NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42),
  value NUMERIC(78, 0) NOT NULL,
  gas_price NUMERIC(78, 0) NOT NULL,
  gas_used NUMERIC(78, 0) NOT NULL,
  gas_limit NUMERIC(78, 0) NOT NULL DEFAULT 0,
  effective_gas_price NUMERIC(78, 0) NOT NULL DEFAULT 0,
  max_fee_per_gas NUMERIC(78, 0),
  max_priority_fee_per_gas NUMERIC(78, 0),
  base_fee_per_gas NUMERIC(78, 0),
  tx_type SMALLINT NOT NULL DEFAULT 0,
  input TEXT NOT NULL,
  nonce NUMERIC(78, 0) NOT NULL,
  status BOOLEAN NOT NULL,
  timestamp BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  transaction_hash VARCHAR(66) NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  block_number BIGINT NOT NULL,
  log_index INTEGER NOT NULL,
  address VARCHAR(42) NOT NULL,
  topic0 VARCHAR(66),
  topic1 VARCHAR(66),
  topic2 VARCHAR(66),
  topic3 VARCHAR(66),
  data TEXT NOT NULL,
  PRIMARY KEY (transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS bridge_deposits (
  bridge_id VARCHAR(66) PRIMARY KEY,
  direction TEXT NOT NULL DEFAULT 'l1_to_l2',
  token_address VARCHAR(42),
  from_address VARCHAR(42),
  to_address VARCHAR(42),
  amount NUMERIC(78, 0),
  l1_tx_hash VARCHAR(66),
  l1_block_number BIGINT,
  l1_timestamp BIGINT,
  l2_tx_hash VARCHAR(66),
  l2_block_number BIGINT,
  l2_timestamp BIGINT,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bridge_withdrawals (
  bridge_id VARCHAR(66) PRIMARY KEY,
  direction TEXT NOT NULL DEFAULT 'l2_to_l1',
  token_address VARCHAR(42),
  from_address VARCHAR(42),
  to_address VARCHAR(42),
  amount NUMERIC(78, 0),
  l1_tx_hash VARCHAR(66),
  l1_block_number BIGINT,
  l1_timestamp BIGINT,
  l2_tx_hash VARCHAR(66),
  l2_block_number BIGINT,
  l2_timestamp BIGINT,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash);
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp);

CREATE INDEX IF NOT EXISTS idx_txs_block_number ON transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_txs_from_address ON transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_txs_to_address ON transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_txs_timestamp ON transactions(timestamp);

CREATE INDEX IF NOT EXISTS idx_logs_block_number ON logs(block_number);
CREATE INDEX IF NOT EXISTS idx_logs_address ON logs(address);
CREATE INDEX IF NOT EXISTS idx_logs_topic0 ON logs(topic0);

CREATE INDEX IF NOT EXISTS idx_bridge_deposits_from ON bridge_deposits(from_address);
CREATE INDEX IF NOT EXISTS idx_bridge_deposits_to ON bridge_deposits(to_address);
CREATE INDEX IF NOT EXISTS idx_bridge_deposits_status ON bridge_deposits(status);
CREATE INDEX IF NOT EXISTS idx_bridge_deposits_l1_block ON bridge_deposits(l1_block_number);
CREATE INDEX IF NOT EXISTS idx_bridge_deposits_l2_block ON bridge_deposits(l2_block_number);
CREATE INDEX IF NOT EXISTS idx_bridge_deposits_updated ON bridge_deposits(updated_at);

CREATE INDEX IF NOT EXISTS idx_bridge_withdrawals_from ON bridge_withdrawals(from_address);
CREATE INDEX IF NOT EXISTS idx_bridge_withdrawals_to ON bridge_withdrawals(to_address);
CREATE INDEX IF NOT EXISTS idx_bridge_withdrawals_status ON bridge_withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_bridge_withdrawals_l1_block ON bridge_withdrawals(l1_block_number);
CREATE INDEX IF NOT EXISTS idx_bridge_withdrawals_l2_block ON bridge_withdrawals(l2_block_number);
CREATE INDEX IF NOT EXISTS idx_bridge_withdrawals_updated ON bridge_withdrawals(updated_at);

ALTER TABLE bridge_withdrawals ADD COLUMN IF NOT EXISTS l1_queue_tx_hash VARCHAR(66);
ALTER TABLE bridge_withdrawals ADD COLUMN IF NOT EXISTS l1_queue_block_number BIGINT;
ALTER TABLE bridge_withdrawals ADD COLUMN IF NOT EXISTS l1_queue_timestamp BIGINT;
ALTER TABLE bridge_withdrawals ADD COLUMN IF NOT EXISTS l1_finalization_tx_hash VARCHAR(66);
ALTER TABLE bridge_withdrawals ADD COLUMN IF NOT EXISTS l1_finalization_block_number BIGINT;
ALTER TABLE bridge_withdrawals ADD COLUMN IF NOT EXISTS l1_finalization_timestamp BIGINT;


ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gas_limit NUMERIC(78, 0) NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS effective_gas_price NUMERIC(78, 0) NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS max_fee_per_gas NUMERIC(78, 0);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS max_priority_fee_per_gas NUMERIC(78, 0);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_fee_per_gas NUMERIC(78, 0);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_type SMALLINT NOT NULL DEFAULT 0;
