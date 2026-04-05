import { query } from '../connection';
import { Log } from '../../types';

export async function insertLog(log: Log): Promise<void> {
  const text = `
    INSERT INTO logs (
      transaction_hash, block_number, log_index, address,
      topic0, topic1, topic2, topic3, data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (transaction_hash, log_index) DO NOTHING
  `;
  
  await query(text, [
    log.transactionHash,
    log.blockNumber.toString(),
    log.logIndex,
    log.address,
    log.topic0,
    log.topic1,
    log.topic2,
    log.topic3,
    log.data,
  ]);
}

export async function getLogsByTransaction(txHash: string): Promise<Log[]> {
  const text = `
    SELECT * FROM logs
    WHERE transaction_hash = $1
    ORDER BY log_index ASC
  `;
  
  const rows = await query<any>(text, [txHash]);
  return rows.map(rowToLog);
}


export async function getLogsByTransactionHashes(hashes: string[]): Promise<Log[]> {
  if (hashes.length == 0) return [];

  const text = `
    SELECT * FROM logs
    WHERE transaction_hash = ANY($1)
    ORDER BY block_number DESC, log_index ASC
  `;

  const rows = await query<any>(text, [hashes]);
  return rows.map(rowToLog);
}

export async function getLogsByAddress(
  address: string,
  limit: number = 100,
  offset: number = 0
): Promise<Log[]> {
  const text = `
    SELECT * FROM logs
    WHERE address = $1
    ORDER BY block_number DESC, log_index DESC
    LIMIT $2 OFFSET $3
  `;
  
  const rows = await query<any>(text, [address.toLowerCase(), limit, offset]);
  return rows.map(rowToLog);
}

export async function getLogsByTopic(
  topic: string,
  topicIndex: number = 0,
  limit: number = 100
): Promise<Log[]> {
  const topicColumn = `topic${topicIndex}`;
  const text = `
    SELECT * FROM logs
    WHERE ${topicColumn} = $1
    ORDER BY block_number DESC, log_index DESC
    LIMIT $2
  `;
  
  const rows = await query<any>(text, [topic, limit]);
  return rows.map(rowToLog);
}

function rowToLog(row: any): Log {
  return {
    transactionHash: row.transaction_hash,
    blockNumber: BigInt(row.block_number),
    logIndex: row.log_index,
    address: row.address,
    topic0: row.topic0,
    topic1: row.topic1,
    topic2: row.topic2,
    topic3: row.topic3,
    data: row.data,
  };
}