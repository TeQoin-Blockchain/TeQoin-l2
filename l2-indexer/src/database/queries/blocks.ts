import { query } from '../connection';
import { Block } from '../../types';

export async function insertBlock(block: Block): Promise<void> {
  const text = `
    INSERT INTO blocks (number, hash, parent_hash, timestamp, miner, gas_used, gas_limit, transaction_count)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (number) DO UPDATE SET
      hash = EXCLUDED.hash,
      parent_hash = EXCLUDED.parent_hash,
      timestamp = EXCLUDED.timestamp,
      miner = EXCLUDED.miner,
      gas_used = EXCLUDED.gas_used,
      gas_limit = EXCLUDED.gas_limit,
      transaction_count = EXCLUDED.transaction_count
  `;

  await query(text, [
    block.number.toString(),
    block.hash,
    block.parentHash,
    block.timestamp.toString(),
    block.miner,
    block.gasUsed.toString(),
    block.gasLimit.toString(),
    block.transactionCount,
  ]);
}

export async function getBlock(numberOrHash: string | bigint): Promise<Block | null> {
  const isHash = typeof numberOrHash === 'string' && numberOrHash.startsWith('0x');

  const text = isHash
    ? 'SELECT * FROM blocks WHERE hash = $1'
    : 'SELECT * FROM blocks WHERE number = $1';

  const params = [isHash ? numberOrHash : numberOrHash.toString()];
  const rows = await query<any>(text, params);

  if (rows.length === 0) return null;

  return rowToBlock(rows[0]);
}

export async function getLatestBlock(): Promise<Block | null> {
  const text = 'SELECT * FROM blocks ORDER BY number DESC LIMIT 1';
  const rows = await query<any>(text);

  if (rows.length === 0) return null;

  return rowToBlock(rows[0]);
}

export async function getLatestBlocks(limit: number = 20): Promise<Block[]> {
  const text = `
    SELECT * FROM blocks
    ORDER BY number DESC
    LIMIT $1
  `;
  const rows = await query<any>(text, [limit]);
  return rows.map(rowToBlock);
}

export async function getBlockCount(): Promise<number> {
  const text = 'SELECT COUNT(*)::int as count FROM blocks';
  const rows = await query<{ count: number }>(text);
  return rows[0].count;
}

export async function deleteBlocksAfter(blockNumber: bigint): Promise<void> {
  const text = 'DELETE FROM blocks WHERE number > $1';
  await query(text, [blockNumber.toString()]);
}

function rowToBlock(row: any): Block {
  return {
    number: BigInt(row.number),
    hash: row.hash,
    parentHash: row.parent_hash,
    timestamp: BigInt(row.timestamp),
    miner: row.miner,
    gasUsed: BigInt(row.gas_used),
    gasLimit: BigInt(row.gas_limit),
    transactionCount: row.transaction_count,
  };
}
