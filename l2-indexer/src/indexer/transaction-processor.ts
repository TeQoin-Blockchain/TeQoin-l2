import rpcService from '../services/rpc.service';
import { insertBlock } from '../database/queries/blocks';
import { insertTransaction } from '../database/queries/transactions';
import { insertLog } from '../database/queries/logs';
import { incrementTotalBlocks, incrementTotalTransactions } from '../database/queries/state';
import logger from '../utils/logger';

export class TransactionProcessor {
  async processBlock(blockNumber: bigint): Promise<void> {
    try {
      // Fetch block data
      const block = await rpcService.getBlock(blockNumber);
      if (!block) {
        logger.warn('Block not found', { blockNumber: blockNumber.toString() });
        return;
      }
      
      // Insert block
      await insertBlock(block);
      
      // Fetch and process transactions
      const transactions = await rpcService.getTransactionsInBlock(blockNumber);
      
      for (const tx of transactions) {
        await insertTransaction(tx);
      }
      
      // Fetch and process logs
      const logs = await rpcService.getLogsInBlock(blockNumber);
      
      for (const log of logs) {
        await insertLog(log);
      }
      
      // Update statistics
      await incrementTotalBlocks();
      if (transactions.length > 0) {
        await incrementTotalTransactions(transactions.length);
      }
      
      logger.debug('Block processed', {
        blockNumber: blockNumber.toString(),
        transactions: transactions.length,
        logs: logs.length,
      });
      
    } catch (error: any) {
      logger.error('Failed to process block', {
        blockNumber: blockNumber.toString(),
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}