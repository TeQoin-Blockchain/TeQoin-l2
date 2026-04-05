import { getBlock, deleteBlocksAfter } from '../database/queries/blocks';
import { getLastIndexedBlock, setLastIndexedBlock } from '../database/queries/state';
import rpcService from '../services/rpc.service';
import logger from '../utils/logger';

/**
 * Reorganization Handler
 * Handles blockchain reorganizations (chain reorgs)
 */

export class ReorgHandler {
  /**
   * Check if a reorganization has occurred
   * Returns the last valid block number if reorg detected, null otherwise
   */
  async detectReorg(): Promise<bigint | null> {
    try {
      const lastIndexedBlock = await getLastIndexedBlock();
      
      // Check last 10 blocks for consistency
      const checkDepth = 10;
      const startBlock = lastIndexedBlock - BigInt(checkDepth);
      
      for (let i = lastIndexedBlock; i >= startBlock && i >= 0n; i--) {
        const dbBlock = await getBlock(i);
        if (!dbBlock) continue;
        
        const chainBlock = await rpcService.getBlock(i);
        if (!chainBlock) continue;
        
        // Compare block hashes
        if (dbBlock.hash !== chainBlock.hash) {
          logger.warn('Reorg detected!', {
            blockNumber: i.toString(),
            dbHash: dbBlock.hash,
            chainHash: chainBlock.hash,
          });
          
          // Find the common ancestor
          return await this.findCommonAncestor(i);
        }
      }
      
      return null;
      
    } catch (error: any) {
      logger.error('Error detecting reorg', { error: error.message });
      return null;
    }
  }
  
  /**
   * Find the last common block between database and chain
   */
  private async findCommonAncestor(fromBlock: bigint): Promise<bigint> {
    let current = fromBlock;
    
    while (current >= 0n) {
      const dbBlock = await getBlock(current);
      const chainBlock = await rpcService.getBlock(current);
      
      if (dbBlock && chainBlock && dbBlock.hash === chainBlock.hash) {
        logger.info('Common ancestor found', {
          blockNumber: current.toString(),
          hash: dbBlock.hash,
        });
        return current;
      }
      
      current--;
    }
    
    // Should not happen unless entire chain is reorged
    logger.error('No common ancestor found, this should not happen!');
    return 0n;
  }
  
  /**
   * Handle a detected reorganization
   */
  async handleReorg(commonBlock: bigint): Promise<void> {
    try {
      logger.info('Handling reorg', {
        commonBlock: commonBlock.toString(),
      });
      
      // Delete all blocks after the common ancestor
      await deleteBlocksAfter(commonBlock);
      
      // Update last indexed block
      await setLastIndexedBlock(commonBlock);
      
      logger.info('Reorg handled successfully', {
        revertedTo: commonBlock.toString(),
      });
      
    } catch (error: any) {
      logger.error('Failed to handle reorg', {
        commonBlock: commonBlock.toString(),
        error: error.message,
      });
      throw error;
    }
  }
  
  /**
   * Monitor for reorgs periodically
   */
  async monitorReorgs(): Promise<void> {
    const reorgBlock = await this.detectReorg();
    
    if (reorgBlock !== null) {
      await this.handleReorg(reorgBlock);
    }
  }
}

export default new ReorgHandler();