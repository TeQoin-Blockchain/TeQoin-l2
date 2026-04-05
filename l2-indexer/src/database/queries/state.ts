import { query } from '../connection';

export async function getState(key: string): Promise<string | null> {
  const text = 'SELECT value FROM indexer_state WHERE key = $1';
  const rows = await query<{ value: string }>(text, [key]);
  return rows.length > 0 ? rows[0].value : null;
}

export async function setState(key: string, value: string): Promise<void> {
  const text = `
    INSERT INTO indexer_state (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW()
  `;
  await query(text, [key, value]);
}

export async function getLastIndexedBlock(): Promise<bigint> {
  const value = await getState('last_indexed_block');
  return BigInt(value || '0');
}

export async function setLastIndexedBlock(blockNumber: bigint): Promise<void> {
  await setState('last_indexed_block', blockNumber.toString());
}

export async function getIndexerStatus(): Promise<string> {
  return await getState('indexer_status') || 'stopped';
}

export async function setIndexerStatus(status: 'running' | 'stopped' | 'error'): Promise<void> {
  await setState('indexer_status', status);
}

export async function incrementTotalBlocks(): Promise<void> {
  const current = await getState('total_blocks_indexed') || '0';
  const next = (BigInt(current) + 1n).toString();
  await setState('total_blocks_indexed', next);
}

export async function incrementTotalTransactions(count: number): Promise<void> {
  const current = await getState('total_transactions_indexed') || '0';
  const next = (BigInt(current) + BigInt(count)).toString();
  await setState('total_transactions_indexed', next);
}