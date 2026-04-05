import rpcService from '../services/rpc.service';
import { TransactionProcessor } from './transaction-processor';
import logger from '../utils/logger';
import config from '../config';
import { getLastIndexedBlock, setLastIndexedBlock, setIndexerStatus } from '../database/queries/state';

export class BlockListener {
  private isRunning: boolean = false;
  private processor: TransactionProcessor;
  private pollInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    this.processor = new TransactionProcessor();
  }
  
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Block listener already running');
      return;
    }
    
    logger.info('Starting block listener...');
    
    try {
      // Connect WebSocket for real-time block notifications
      await rpcService.connectWebSocket();
      
      // Get last indexed block from database
      const lastIndexed = await getLastIndexedBlock();
      const currentBlock = await rpcService.getCurrentBlockNumber();
      
      logger.info('Block listener initialized', {
        lastIndexed: lastIndexed.toString(),
        currentBlock: currentBlock.toString(),
        blocksToSync: (currentBlock - lastIndexed).toString(),
      });
      
      // Set status to running
      await setIndexerStatus('running');
      this.isRunning = true;
      
      // Sync historical blocks first
      if (lastIndexed < currentBlock) {
        await this.syncHistoricalBlocks(lastIndexed + 1n, currentBlock);
      }
      
      // Listen for new blocks
      this.listenForNewBlocks();
      
      // Fallback polling (in case WebSocket fails)
      this.startPolling();
      
      logger.info('Block listener started successfully');
      
    } catch (error: any) {
      logger.error('Failed to start block listener', { error: error.message });
      await setIndexerStatus('error');
      throw error;
    }
  }
  
  private async syncHistoricalBlocks(fromBlock: bigint, toBlock: bigint): Promise<void> {
    logger.info('Syncing historical blocks', {
      from: fromBlock.toString(),
      to: toBlock.toString(),
      total: (toBlock - fromBlock + 1n).toString(),
    });
    
    const batchSize = BigInt(config.indexer.batchSize);
    let currentBlock = fromBlock;
    
    while (currentBlock <= toBlock && this.isRunning) {
      const endBlock = currentBlock + batchSize - 1n > toBlock
        ? toBlock
        : currentBlock + batchSize - 1n;
      
      try {
        await this.processBatch(currentBlock, endBlock);
        currentBlock = endBlock + 1n;
        
        // Log progress
        const progress = Number(((currentBlock - fromBlock) * 100n) / (toBlock - fromBlock + 1n));
        logger.info(`Sync progress: ${progress.toFixed(1)}%`, {
          current: currentBlock.toString(),
          target: toBlock.toString(),
        });
        
      } catch (error: any) {
        logger.error('Error syncing batch', {
          from: currentBlock.toString(),
          to: endBlock.toString(),
          error: error.message,
        });
        
        // Retry after delay
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    logger.info('Historical sync complete');
  }
  
  private async processBatch(fromBlock: bigint, toBlock: bigint): Promise<void> {
    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
      if (!this.isRunning) break;
      
      try {
        await this.processor.processBlock(blockNum);
        await setLastIndexedBlock(blockNum);
      } catch (error: any) {
        logger.error('Failed to process block', {
          blockNumber: blockNum.toString(),
          error: error.message,
        });
        throw error;
      }
    }
  }
  
  private listenForNewBlocks(): void {
    rpcService.onBlock(async (blockNumber: bigint) => {
      if (!this.isRunning) return;
      
      try {
        const lastIndexed = await getLastIndexedBlock();
        
        // Process this block if it's next in sequence
        if (blockNumber === lastIndexed + 1n) {
          await this.processor.processBlock(blockNumber);
          await setLastIndexedBlock(blockNumber);
          
          logger.info('New block indexed', {
            blockNumber: blockNumber.toString(),
          });
        } else if (blockNumber > lastIndexed + 1n) {
          // Missed blocks - sync them
          logger.warn('Missed blocks detected, syncing', {
            lastIndexed: lastIndexed.toString(),
            newBlock: blockNumber.toString(),
          });
          await this.syncHistoricalBlocks(lastIndexed + 1n, blockNumber);
        }
      } catch (error: any) {
        logger.error('Error processing new block', {
          blockNumber: blockNumber.toString(),
          error: error.message,
        });
      }
    });
  }
  
  private startPolling(): void {
    this.pollInterval = setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        const currentBlock = await rpcService.getCurrentBlockNumber();
        const lastIndexed = await getLastIndexedBlock();
        
        // Check if we're behind
        if (currentBlock > lastIndexed) {
          logger.debug('Polling detected new blocks', {
            lastIndexed: lastIndexed.toString(),
            current: currentBlock.toString(),
          });
          
          // Process missing blocks
          await this.syncHistoricalBlocks(lastIndexed + 1n, currentBlock);
        }
      } catch (error: any) {
        logger.error('Polling error', { error: error.message });
      }
    }, config.indexer.pollInterval);
  }
  
  async stop(): Promise<void> {
    logger.info('Stopping block listener...');
    
    this.isRunning = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    await rpcService.close();
    await setIndexerStatus('stopped');
    
    logger.info('Block listener stopped');
  }
  
  isActive(): boolean {
    return this.isRunning;
  }
}