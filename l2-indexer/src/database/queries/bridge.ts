import { query } from '../connection';
import { BridgeDirection, BridgeRecord, BridgeTransactionLink } from '../../types';

interface DepositInitInput {
  bridgeId: string;
  tokenAddress: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  l1TxHash: string;
  l1BlockNumber: bigint;
  l1Timestamp: bigint;
}

interface DepositProcessedInput {
  bridgeId: string;
  tokenAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  l2TxHash: string;
  l2BlockNumber: bigint;
  l2Timestamp: bigint;
}

interface WithdrawalInitInput {
  bridgeId: string;
  tokenAddress: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  l2TxHash: string;
  l2BlockNumber: bigint;
  l2Timestamp: bigint;
}

interface WithdrawalL1StatusInput {
  bridgeId: string;
  status: string;
  tokenAddress?: string | null;
  toAddress?: string | null;
  amount?: string | null;
  l1TxHash: string;
  l1BlockNumber: bigint;
  l1Timestamp: bigint;
}

export async function upsertL1DepositInitiated(input: DepositInitInput): Promise<void> {
  const text = `
    INSERT INTO bridge_deposits (
      bridge_id, direction, token_address, from_address, to_address, amount,
      l1_tx_hash, l1_block_number, l1_timestamp, status, updated_at
    )
    VALUES ($1, 'l1_to_l2', $2, $3, $4, $5, $6, $7, $8, 'initiated', NOW())
    ON CONFLICT (bridge_id) DO UPDATE SET
      token_address = COALESCE(EXCLUDED.token_address, bridge_deposits.token_address),
      from_address = COALESCE(EXCLUDED.from_address, bridge_deposits.from_address),
      to_address = COALESCE(EXCLUDED.to_address, bridge_deposits.to_address),
      amount = COALESCE(EXCLUDED.amount, bridge_deposits.amount),
      l1_tx_hash = COALESCE(EXCLUDED.l1_tx_hash, bridge_deposits.l1_tx_hash),
      l1_block_number = COALESCE(EXCLUDED.l1_block_number, bridge_deposits.l1_block_number),
      l1_timestamp = COALESCE(EXCLUDED.l1_timestamp, bridge_deposits.l1_timestamp),
      status = CASE
        WHEN bridge_deposits.status IN ('processed', 'finalized') THEN bridge_deposits.status
        ELSE 'initiated'
      END,
      updated_at = NOW()
  `;

  await query(text, [
    input.bridgeId,
    input.tokenAddress,
    input.fromAddress,
    input.toAddress,
    input.amount,
    input.l1TxHash,
    input.l1BlockNumber.toString(),
    input.l1Timestamp.toString(),
  ]);
}

export async function upsertL2DepositProcessed(input: DepositProcessedInput): Promise<void> {
  const text = `
    INSERT INTO bridge_deposits (
      bridge_id, direction, token_address, to_address, amount,
      l2_tx_hash, l2_block_number, l2_timestamp, status, updated_at
    )
    VALUES ($1, 'l1_to_l2', $2, $3, $4, $5, $6, $7, 'processed', NOW())
    ON CONFLICT (bridge_id) DO UPDATE SET
      token_address = COALESCE(EXCLUDED.token_address, bridge_deposits.token_address),
      to_address = COALESCE(EXCLUDED.to_address, bridge_deposits.to_address),
      amount = COALESCE(EXCLUDED.amount, bridge_deposits.amount),
      l2_tx_hash = COALESCE(EXCLUDED.l2_tx_hash, bridge_deposits.l2_tx_hash),
      l2_block_number = COALESCE(EXCLUDED.l2_block_number, bridge_deposits.l2_block_number),
      l2_timestamp = COALESCE(EXCLUDED.l2_timestamp, bridge_deposits.l2_timestamp),
      status = 'processed',
      updated_at = NOW()
  `;

  await query(text, [
    input.bridgeId,
    input.tokenAddress,
    input.toAddress,
    input.amount,
    input.l2TxHash,
    input.l2BlockNumber.toString(),
    input.l2Timestamp.toString(),
  ]);
}

export async function upsertL2WithdrawalInitiated(input: WithdrawalInitInput): Promise<void> {
  const text = `
    INSERT INTO bridge_withdrawals (
      bridge_id, direction, token_address, from_address, to_address, amount,
      l2_tx_hash, l2_block_number, l2_timestamp, status, updated_at
    )
    VALUES ($1, 'l2_to_l1', $2, $3, $4, $5, $6, $7, $8, 'initiated', NOW())
    ON CONFLICT (bridge_id) DO UPDATE SET
      token_address = COALESCE(EXCLUDED.token_address, bridge_withdrawals.token_address),
      from_address = COALESCE(EXCLUDED.from_address, bridge_withdrawals.from_address),
      to_address = COALESCE(EXCLUDED.to_address, bridge_withdrawals.to_address),
      amount = COALESCE(EXCLUDED.amount, bridge_withdrawals.amount),
      l2_tx_hash = COALESCE(EXCLUDED.l2_tx_hash, bridge_withdrawals.l2_tx_hash),
      l2_block_number = COALESCE(EXCLUDED.l2_block_number, bridge_withdrawals.l2_block_number),
      l2_timestamp = COALESCE(EXCLUDED.l2_timestamp, bridge_withdrawals.l2_timestamp),
      status = CASE
        WHEN bridge_withdrawals.status IN ('queued', 'finalized', 'challenged') THEN bridge_withdrawals.status
        ELSE 'initiated'
      END,
      updated_at = NOW()
  `;

  await query(text, [
    input.bridgeId,
    input.tokenAddress,
    input.fromAddress,
    input.toAddress,
    input.amount,
    input.l2TxHash,
    input.l2BlockNumber.toString(),
    input.l2Timestamp.toString(),
  ]);
}

export async function upsertL1WithdrawalStatus(input: WithdrawalL1StatusInput): Promise<void> {
  const text = `
    INSERT INTO bridge_withdrawals (
      bridge_id, direction, token_address, to_address, amount,
      l1_tx_hash, l1_block_number, l1_timestamp, status, updated_at
    )
    VALUES ($1, 'l2_to_l1', $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (bridge_id) DO UPDATE SET
      token_address = COALESCE(EXCLUDED.token_address, bridge_withdrawals.token_address),
      to_address = COALESCE(EXCLUDED.to_address, bridge_withdrawals.to_address),
      amount = COALESCE(EXCLUDED.amount, bridge_withdrawals.amount),
      l1_tx_hash = COALESCE(EXCLUDED.l1_tx_hash, bridge_withdrawals.l1_tx_hash),
      l1_block_number = COALESCE(EXCLUDED.l1_block_number, bridge_withdrawals.l1_block_number),
      l1_timestamp = COALESCE(EXCLUDED.l1_timestamp, bridge_withdrawals.l1_timestamp),
      l1_queue_tx_hash = CASE
        WHEN EXCLUDED.status = 'queued' THEN COALESCE(EXCLUDED.l1_tx_hash, bridge_withdrawals.l1_queue_tx_hash)
        ELSE bridge_withdrawals.l1_queue_tx_hash
      END,
      l1_queue_block_number = CASE
        WHEN EXCLUDED.status = 'queued' THEN COALESCE(EXCLUDED.l1_block_number, bridge_withdrawals.l1_queue_block_number)
        ELSE bridge_withdrawals.l1_queue_block_number
      END,
      l1_queue_timestamp = CASE
        WHEN EXCLUDED.status = 'queued' THEN COALESCE(EXCLUDED.l1_timestamp, bridge_withdrawals.l1_queue_timestamp)
        ELSE bridge_withdrawals.l1_queue_timestamp
      END,
      l1_finalization_tx_hash = CASE
        WHEN EXCLUDED.status = 'finalized' THEN COALESCE(EXCLUDED.l1_tx_hash, bridge_withdrawals.l1_finalization_tx_hash)
        ELSE bridge_withdrawals.l1_finalization_tx_hash
      END,
      l1_finalization_block_number = CASE
        WHEN EXCLUDED.status = 'finalized' THEN COALESCE(EXCLUDED.l1_block_number, bridge_withdrawals.l1_finalization_block_number)
        ELSE bridge_withdrawals.l1_finalization_block_number
      END,
      l1_finalization_timestamp = CASE
        WHEN EXCLUDED.status = 'finalized' THEN COALESCE(EXCLUDED.l1_timestamp, bridge_withdrawals.l1_finalization_timestamp)
        ELSE bridge_withdrawals.l1_finalization_timestamp
      END,
      status = EXCLUDED.status,
      updated_at = NOW()
  `;

  await query(text, [
    input.bridgeId,
    input.tokenAddress || null,
    input.toAddress || null,
    input.amount || null,
    input.l1TxHash,
    input.l1BlockNumber.toString(),
    input.l1Timestamp.toString(),
    input.status,
  ]);
}

export async function getLatestBridgeActivity(limit: number = 20): Promise<BridgeRecord[]> {
  const text = `
    WITH combined AS (
      SELECT
        bridge_id, direction, token_address, from_address, to_address, amount,
        l1_tx_hash, l1_block_number, l1_timestamp,
        NULL::text AS l1_queue_tx_hash,
        NULL::bigint AS l1_queue_block_number,
        NULL::bigint AS l1_queue_timestamp,
        NULL::text AS l1_finalization_tx_hash,
        NULL::bigint AS l1_finalization_block_number,
        NULL::bigint AS l1_finalization_timestamp,
        l2_tx_hash, l2_block_number, l2_timestamp, status, created_at, updated_at,
        GREATEST(COALESCE(l1_timestamp, 0), COALESCE(l2_timestamp, 0)) AS sort_ts
      FROM bridge_deposits
      UNION ALL
      SELECT
        bridge_id, direction, token_address, from_address, to_address, amount,
        l1_tx_hash, l1_block_number, l1_timestamp,
        l1_queue_tx_hash,
        l1_queue_block_number,
        l1_queue_timestamp,
        l1_finalization_tx_hash,
        l1_finalization_block_number,
        l1_finalization_timestamp,
        l2_tx_hash, l2_block_number, l2_timestamp, status, created_at, updated_at,
        GREATEST(COALESCE(l1_timestamp, 0), COALESCE(l2_timestamp, 0)) AS sort_ts
      FROM bridge_withdrawals
    )
    SELECT * FROM combined
    ORDER BY sort_ts DESC, updated_at DESC
    LIMIT $1
  `;
  const rows = await query<any>(text, [limit]);
  return rows.map(rowToBridgeRecord);
}

export async function getBridgeTransactionCount(): Promise<number> {
  const text = `
    SELECT (
      SELECT COUNT(*)::int FROM bridge_deposits
    ) + (
      SELECT COUNT(*)::int FROM bridge_withdrawals
    ) AS count
  `;

  const rows = await query<{ count: number }>(text);
  return rows[0]?.count || 0;
}

export async function getLatestBridgeByDirection(
  direction: BridgeDirection,
  limit: number = 20
): Promise<BridgeRecord[]> {
  const table = direction === 'l1_to_l2' ? 'bridge_deposits' : 'bridge_withdrawals';
  const text = `
    SELECT *, GREATEST(COALESCE(l1_timestamp, 0), COALESCE(l2_timestamp, 0)) AS sort_ts
    FROM ${table}
    ORDER BY sort_ts DESC, updated_at DESC
    LIMIT $1
  `;
  const rows = await query<any>(text, [limit]);
  return rows.map(rowToBridgeRecord);
}

export async function getBridgeById(bridgeId: string): Promise<BridgeRecord | null> {
  const text = `
    SELECT
      bridge_id, direction, token_address, from_address, to_address, amount,
      l1_tx_hash, l1_block_number, l1_timestamp,
      NULL::text AS l1_queue_tx_hash,
      NULL::bigint AS l1_queue_block_number,
      NULL::bigint AS l1_queue_timestamp,
      NULL::text AS l1_finalization_tx_hash,
      NULL::bigint AS l1_finalization_block_number,
      NULL::bigint AS l1_finalization_timestamp,
      l2_tx_hash, l2_block_number, l2_timestamp, status, created_at, updated_at,
      GREATEST(COALESCE(l1_timestamp, 0), COALESCE(l2_timestamp, 0)) AS sort_ts
    FROM bridge_deposits WHERE bridge_id = $1
    UNION ALL
    SELECT
      bridge_id, direction, token_address, from_address, to_address, amount,
      l1_tx_hash, l1_block_number, l1_timestamp,
      l1_queue_tx_hash,
      l1_queue_block_number,
      l1_queue_timestamp,
      l1_finalization_tx_hash,
      l1_finalization_block_number,
      l1_finalization_timestamp,
      l2_tx_hash, l2_block_number, l2_timestamp, status, created_at, updated_at,
      GREATEST(COALESCE(l1_timestamp, 0), COALESCE(l2_timestamp, 0)) AS sort_ts
    FROM bridge_withdrawals WHERE bridge_id = $1
    LIMIT 1
  `;
  const rows = await query<any>(text, [bridgeId.toLowerCase()]);
  if (rows.length === 0) return null;
  return rowToBridgeRecord(rows[0]);
}

export async function getBridgeHistoryByAddress(
  address: string,
  limit: number = 50,
  offset: number = 0
): Promise<BridgeRecord[]> {
  const lower = address.toLowerCase();
  const text = `
    WITH combined AS (
      SELECT
        bridge_id, direction, token_address, from_address, to_address, amount,
        l1_tx_hash, l1_block_number, l1_timestamp,
        NULL::text AS l1_queue_tx_hash,
        NULL::bigint AS l1_queue_block_number,
        NULL::bigint AS l1_queue_timestamp,
        NULL::text AS l1_finalization_tx_hash,
        NULL::bigint AS l1_finalization_block_number,
        NULL::bigint AS l1_finalization_timestamp,
        l2_tx_hash, l2_block_number, l2_timestamp, status, created_at, updated_at,
        GREATEST(COALESCE(l1_timestamp, 0), COALESCE(l2_timestamp, 0)) AS sort_ts
      FROM bridge_deposits
      WHERE from_address = $1 OR to_address = $1
      UNION ALL
      SELECT
        bridge_id, direction, token_address, from_address, to_address, amount,
        l1_tx_hash, l1_block_number, l1_timestamp,
        l1_queue_tx_hash,
        l1_queue_block_number,
        l1_queue_timestamp,
        l1_finalization_tx_hash,
        l1_finalization_block_number,
        l1_finalization_timestamp,
        l2_tx_hash, l2_block_number, l2_timestamp, status, created_at, updated_at,
        GREATEST(COALESCE(l1_timestamp, 0), COALESCE(l2_timestamp, 0)) AS sort_ts
      FROM bridge_withdrawals
      WHERE from_address = $1 OR to_address = $1
    )
    SELECT * FROM combined
    ORDER BY sort_ts DESC, updated_at DESC
    LIMIT $2 OFFSET $3
  `;

  const rows = await query<any>(text, [lower, limit, offset]);
  return rows.map(rowToBridgeRecord);
}

export async function getBridgeHistoryCountByAddress(address: string): Promise<number> {
  const lower = address.toLowerCase();
  const text = `
    SELECT (
      (SELECT COUNT(*) FROM bridge_deposits WHERE from_address = $1 OR to_address = $1) +
      (SELECT COUNT(*) FROM bridge_withdrawals WHERE from_address = $1 OR to_address = $1)
    )::int AS count
  `;

  const rows = await query<{ count: number }>(text, [lower]);
  return rows[0]?.count || 0;
}

export async function getBridgeLinksByTransactionHashes(
  hashes: string[]
): Promise<Map<string, BridgeTransactionLink>> {
  const normalized = Array.from(new Set(hashes.map((hash) => hash.toLowerCase()).filter(Boolean)));
  const bridgeMap = new Map<string, BridgeTransactionLink>();

  if (normalized.length === 0) {
    return bridgeMap;
  }

  const text = `
    WITH tx_hashes AS (
      SELECT UNNEST($1::text[]) AS tx_hash
    ),
    matches AS (
      SELECT
        tx_hashes.tx_hash,
        bd.bridge_id,
        bd.direction,
        CASE WHEN bd.l1_tx_hash = tx_hashes.tx_hash THEN 'source' ELSE 'settlement' END AS role,
        CASE
          WHEN bd.l1_tx_hash = tx_hashes.tx_hash THEN 'l1_source'
          ELSE 'l2_settlement'
        END AS phase,
        'bridge_deposit' AS activity_type,
        bd.status,
        bd.token_address,
        bd.amount,
        bd.from_address,
        bd.to_address,
        bd.l1_timestamp,
        NULL::bigint AS l1_queue_timestamp,
        NULL::bigint AS l1_finalization_timestamp,
        bd.l2_timestamp,
        0 AS priority
      FROM tx_hashes
      JOIN bridge_deposits bd
        ON bd.l1_tx_hash = tx_hashes.tx_hash OR bd.l2_tx_hash = tx_hashes.tx_hash

      UNION ALL

      SELECT
        tx_hashes.tx_hash,
        bw.bridge_id,
        bw.direction,
        CASE WHEN bw.l2_tx_hash = tx_hashes.tx_hash THEN 'source' ELSE 'settlement' END AS role,
        CASE
          WHEN bw.l2_tx_hash = tx_hashes.tx_hash THEN 'l2_source'
          ELSE 'l1_settlement'
        END AS phase,
        'bridge_withdrawal' AS activity_type,
        bw.status,
        bw.token_address,
        bw.amount,
        bw.from_address,
        bw.to_address,
        bw.l1_timestamp,
        bw.l1_queue_timestamp,
        bw.l1_finalization_timestamp,
        bw.l2_timestamp,
        1 AS priority
      FROM tx_hashes
      JOIN bridge_withdrawals bw
        ON bw.l1_tx_hash = tx_hashes.tx_hash OR bw.l2_tx_hash = tx_hashes.tx_hash
    )
    SELECT DISTINCT ON (tx_hash)
      tx_hash,
      bridge_id,
      direction,
      role,
      phase,
      activity_type,
      status,
      token_address,
      amount,
      from_address,
      to_address,
      l1_timestamp,
      l1_queue_timestamp,
      l1_finalization_timestamp,
      l2_timestamp
    FROM matches
    ORDER BY tx_hash, priority ASC
  `;

  const rows = await query<any>(text, [normalized]);
  for (const row of rows) {
    bridgeMap.set(row.tx_hash.toLowerCase(), {
      bridgeId: row.bridge_id,
      direction: row.direction,
      role: row.role,
      phase: row.phase,
      activityType: row.activity_type,
      status: row.status,
      tokenAddress: row.token_address,
      amount: row.amount,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      l1Timestamp: row.l1_timestamp != null ? BigInt(row.l1_timestamp) : null,
      l1QueueTimestamp: row.l1_queue_timestamp != null ? BigInt(row.l1_queue_timestamp) : null,
      l1FinalizationTimestamp: row.l1_finalization_timestamp != null ? BigInt(row.l1_finalization_timestamp) : null,
      l2Timestamp: row.l2_timestamp != null ? BigInt(row.l2_timestamp) : null,
    });
  }

  return bridgeMap;
}

function rowToBridgeRecord(row: any): BridgeRecord {
  return {
    bridgeId: row.bridge_id,
    direction: row.direction,
    tokenAddress: row.token_address,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    amount: row.amount,
    l1TxHash: row.l1_tx_hash,
    l1BlockNumber: row.l1_block_number != null ? BigInt(row.l1_block_number) : null,
    l1Timestamp: row.l1_timestamp != null ? BigInt(row.l1_timestamp) : null,
    l1QueueTxHash: row.l1_queue_tx_hash ?? null,
    l1QueueBlockNumber: row.l1_queue_block_number != null ? BigInt(row.l1_queue_block_number) : null,
    l1QueueTimestamp: row.l1_queue_timestamp != null ? BigInt(row.l1_queue_timestamp) : null,
    l1FinalizationTxHash: row.l1_finalization_tx_hash ?? null,
    l1FinalizationBlockNumber: row.l1_finalization_block_number != null ? BigInt(row.l1_finalization_block_number) : null,
    l1FinalizationTimestamp: row.l1_finalization_timestamp != null ? BigInt(row.l1_finalization_timestamp) : null,
    l2TxHash: row.l2_tx_hash,
    l2BlockNumber: row.l2_block_number != null ? BigInt(row.l2_block_number) : null,
    l2Timestamp: row.l2_timestamp != null ? BigInt(row.l2_timestamp) : null,
    status: row.status,
    updatedAt: row.updated_at,
  };
}
