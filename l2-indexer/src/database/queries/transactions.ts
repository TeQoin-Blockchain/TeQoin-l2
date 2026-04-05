import { query } from '../connection';
import { GasMetrics, TPSMetric, Transaction } from '../../types';

const ERC20_TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface TransactionStatsCounts {
  totalTransactions: number;
  totalSendTransactions: number;
  totalErc20Transactions: number;
}

export async function insertTransaction(tx: Transaction): Promise<void> {
  const text = `
    INSERT INTO transactions (
      hash, block_number, transaction_index, from_address, to_address,
      value, gas_price, gas_used, gas_limit, effective_gas_price,
      max_fee_per_gas, max_priority_fee_per_gas, base_fee_per_gas, tx_type,
      input, nonce, status, timestamp
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (hash) DO UPDATE SET
      block_number = EXCLUDED.block_number,
      transaction_index = EXCLUDED.transaction_index,
      from_address = EXCLUDED.from_address,
      to_address = EXCLUDED.to_address,
      value = EXCLUDED.value,
      gas_price = EXCLUDED.gas_price,
      gas_used = EXCLUDED.gas_used,
      gas_limit = EXCLUDED.gas_limit,
      effective_gas_price = EXCLUDED.effective_gas_price,
      max_fee_per_gas = EXCLUDED.max_fee_per_gas,
      max_priority_fee_per_gas = EXCLUDED.max_priority_fee_per_gas,
      base_fee_per_gas = EXCLUDED.base_fee_per_gas,
      tx_type = EXCLUDED.tx_type,
      input = EXCLUDED.input,
      nonce = EXCLUDED.nonce,
      status = EXCLUDED.status,
      timestamp = EXCLUDED.timestamp
  `;

  await query(text, [
    tx.hash,
    tx.blockNumber.toString(),
    tx.transactionIndex,
    tx.fromAddress,
    tx.toAddress,
    tx.value,
    tx.gasPrice.toString(),
    tx.gasUsed.toString(),
    tx.gasLimit.toString(),
    tx.effectiveGasPrice.toString(),
    tx.maxFeePerGas?.toString() || null,
    tx.maxPriorityFeePerGas?.toString() || null,
    tx.baseFeePerGas?.toString() || null,
    tx.txType,
    tx.input,
    tx.nonce.toString(),
    tx.status,
    tx.timestamp.toString(),
  ]);
}

export async function getTransaction(hash: string): Promise<Transaction | null> {
  const text = 'SELECT * FROM transactions WHERE hash = $1';
  const rows = await query<any>(text, [hash]);

  if (rows.length === 0) return null;

  return rowToTransaction(rows[0]);
}

export async function getLatestTransactions(limit: number = 20): Promise<Transaction[]> {
  const text = `
    SELECT * FROM transactions
    ORDER BY block_number DESC, transaction_index DESC
    LIMIT $1
  `;

  const rows = await query<any>(text, [limit]);
  return rows.map(rowToTransaction);
}

export async function getTransactionsByAddress(
  address: string,
  limit: number = 50,
  offset: number = 0
): Promise<Transaction[]> {
  const lower = address.toLowerCase();
  const paddedAddressTopic = `0x000000000000000000000000${lower.slice(2)}`;

  const text = `
    WITH matched_hashes AS (
      SELECT hash
      FROM transactions
      WHERE from_address = $1 OR to_address = $1

      UNION

      SELECT l.transaction_hash AS hash
      FROM logs l
      WHERE l.topic0 = $2
        AND (l.topic1 = $3 OR l.topic2 = $3)
    )
    SELECT t.*
    FROM transactions t
    JOIN matched_hashes m ON m.hash = t.hash
    ORDER BY t.block_number DESC, t.transaction_index DESC
    LIMIT $4 OFFSET $5
  `;

  const rows = await query<any>(text, [lower, ERC20_TRANSFER_TOPIC0, paddedAddressTopic, limit, offset]);
  return rows.map(rowToTransaction);
}

export async function getTransactionsByBlock(blockNumber: bigint): Promise<Transaction[]> {
  const text = `
    SELECT * FROM transactions
    WHERE block_number = $1
    ORDER BY transaction_index ASC
  `;

  const rows = await query<any>(text, [blockNumber.toString()]);
  return rows.map(rowToTransaction);
}

export async function getTransactionCount(): Promise<number> {
  const text = 'SELECT COUNT(*)::int as count FROM transactions';
  const rows = await query<{ count: number }>(text);
  return rows[0].count;
}

export async function getTransactionStatsCounts(): Promise<TransactionStatsCounts> {
  const text = `
    WITH erc20_hashes AS (
      SELECT DISTINCT transaction_hash
      FROM logs
      WHERE topic0 = $1
    )
    SELECT
      COUNT(*)::int AS total_transactions,
      COUNT(*) FILTER (
        WHERE COALESCE(t.value, '0') <> '0'
          AND NOT EXISTS (
            SELECT 1
            FROM erc20_hashes e
            WHERE e.transaction_hash = t.hash
          )
      )::int AS total_send_transactions,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM erc20_hashes e
          WHERE e.transaction_hash = t.hash
        )
      )::int AS total_erc20_transactions
    FROM transactions t
  `;

  const rows = await query<{
    total_transactions: number;
    total_send_transactions: number;
    total_erc20_transactions: number;
  }>(text, [ERC20_TRANSFER_TOPIC0]);

  const row = rows[0];

  return {
    totalTransactions: row?.total_transactions || 0,
    totalSendTransactions: row?.total_send_transactions || 0,
    totalErc20Transactions: row?.total_erc20_transactions || 0,
  };
}

export async function getAddressTransactionCount(address: string): Promise<number> {
  const lower = address.toLowerCase();
  const paddedAddressTopic = `0x000000000000000000000000${lower.slice(2)}`;

  const text = `
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT hash
      FROM transactions
      WHERE from_address = $1 OR to_address = $1

      UNION

      SELECT l.transaction_hash AS hash
      FROM logs l
      WHERE l.topic0 = $2
        AND (l.topic1 = $3 OR l.topic2 = $3)
    ) merged
  `;

  const rows = await query<{ count: number }>(text, [lower, ERC20_TRANSFER_TOPIC0, paddedAddressTopic]);
  return rows[0].count;
}

export async function getTPS(windowSeconds: number = 60): Promise<TPSMetric> {
  const text = `
    WITH latest AS (
      SELECT COALESCE(MAX(timestamp), 0)::bigint AS max_ts
      FROM transactions
    )
    SELECT
      COUNT(*)::int AS tx_count
    FROM transactions t
    CROSS JOIN latest l
    WHERE t.timestamp > l.max_ts - $1
  `;

  const rows = await query<{ tx_count: number }>(text, [windowSeconds]);
  const transactionCount = rows[0]?.tx_count || 0;
  const tps = Number((transactionCount / windowSeconds).toFixed(4));

  return {
    windowSeconds,
    transactionCount,
    tps,
  };
}

export async function getGasMetrics(windowSeconds: number = 300): Promise<GasMetrics> {
  const text = `
    WITH latest AS (
      SELECT COALESCE(MAX(timestamp), 0)::bigint AS max_ts
      FROM transactions
    )
    SELECT
      COUNT(*)::int AS sample_size,
      COALESCE(AVG(t.gas_used)::text, '0') AS avg_gas_used,
      COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.gas_used)::text, '0') AS median_gas_used,
      COALESCE(AVG(t.gas_price)::text, '0') AS avg_gas_price,
      COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.gas_price)::text, '0') AS median_gas_price
    FROM transactions t
    CROSS JOIN latest l
    WHERE t.timestamp > l.max_ts - $1
  `;

  const rows = await query<{
    sample_size: number;
    avg_gas_used: string;
    median_gas_used: string;
    avg_gas_price: string;
    median_gas_price: string;
  }>(text, [windowSeconds]);

  const row = rows[0] || {
    sample_size: 0,
    avg_gas_used: '0',
    median_gas_used: '0',
    avg_gas_price: '0',
    median_gas_price: '0',
  };

  return {
    windowSeconds,
    sampleSize: row.sample_size,
    avgGasUsed: row.avg_gas_used,
    medianGasUsed: row.median_gas_used,
    avgGasPrice: row.avg_gas_price,
    medianGasPrice: row.median_gas_price,
  };
}

function rowToTransaction(row: any): Transaction {
  return {
    hash: row.hash,
    blockNumber: BigInt(row.block_number),
    transactionIndex: row.transaction_index,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    value: row.value,
    gasPrice: BigInt(row.gas_price),
    gasUsed: BigInt(row.gas_used),
    gasLimit: BigInt(row.gas_limit || 0),
    effectiveGasPrice: BigInt(row.effective_gas_price || row.gas_price || 0),
    maxFeePerGas: row.max_fee_per_gas !== null ? BigInt(row.max_fee_per_gas) : null,
    maxPriorityFeePerGas: row.max_priority_fee_per_gas !== null ? BigInt(row.max_priority_fee_per_gas) : null,
    baseFeePerGas: row.base_fee_per_gas !== null ? BigInt(row.base_fee_per_gas) : null,
    txType: Number(row.tx_type || 0),
    input: row.input,
    nonce: BigInt(row.nonce),
    status: row.status,
    timestamp: BigInt(row.timestamp),
  };
}
