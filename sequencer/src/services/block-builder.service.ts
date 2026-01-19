import { ethers } from 'ethers';
import { Config } from '../types';
import { logger, logService } from '../utils/logger';
import { EngineAPIClient, ExecutionPayload, ForkchoiceState } from '../engine/engine-api-client';

// ═══════════════════════════════════════════════════════
// BLOCK BUILDER SERVICE
// Builds and submits blocks via Engine API
// ═══════════════════════════════════════════════════════

export class BlockBuilderService {
  private l2Provider: ethers.JsonRpcProvider | null = null;
  private engineAPI: EngineAPIClient | null = null;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private blockInterval: number = 5000; // 5 seconds per block
  
  private sequencerAddress: string;
  private lastBlockHash: string = ethers.ZeroHash;
  private lastBlockNumber: number = 0;
  
  constructor(private config: Config) {
    this.sequencerAddress = config.sequencer.address;
  }
  
  /**
   * Start block building
   */
  async start(): Promise<void> {
    logService('BLOCK-BUILDER', 'Starting...');
    
    try {
      // Connect to L2 RPC
      this.l2Provider = new ethers.JsonRpcProvider(this.config.l2.rpcUrl);
      
      // Initialize Engine API client
      this.engineAPI = new EngineAPIClient(
        this.config.l2.engineUrl || 'http://localhost:8552',
        this.config.l2.jwtSecretPath || '/root/optimistic-rollup/infrastructure/docker/jwt.hex'
      );
      
      // Test connectivity
      const isConnected = await this.engineAPI.ping();
      if (!isConnected) {
        throw new Error('Cannot connect to Engine API');
      }
      
      // Get current block state
      await this.initializeState();
      
      this.isRunning = true;
      
      // Start block production loop (every 5 seconds)
      this.intervalId = setInterval(() => {
        this.buildAndSubmitBlock().catch((error) => {
          logger.error('Error in block building loop', { error: error.message });
        });
      }, this.blockInterval);
      
      logService('BLOCK-BUILDER', 'Started successfully', {
        blockInterval: `${this.blockInterval}ms`,
        sequencer: this.sequencerAddress,
      });
      
    } catch (error: any) {
      logService('BLOCK-BUILDER', 'Failed to start', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Initialize state from current chain
   */
  private async initializeState(): Promise<void> {
    const latestBlock = await this.l2Provider!.getBlock('latest');
    
    if (latestBlock) {
      this.lastBlockHash = latestBlock.hash!;
      this.lastBlockNumber = latestBlock.number;
      
      logger.info('Initialized from chain', {
        blockNumber: this.lastBlockNumber,
        blockHash: this.lastBlockHash.slice(0, 10) + '...',
      });
    } else {
      // Genesis block
      this.lastBlockHash = ethers.ZeroHash;
      this.lastBlockNumber = 0;
      
      logger.info('Starting from genesis');
    }
  }
  
  /**
   * Build and submit a new block
   */
  private async buildAndSubmitBlock(): Promise<void> {
    if (!this.isRunning) return;
    
    try {
      const blockNumber = this.lastBlockNumber + 1;
      const timestamp = Math.floor(Date.now() / 1000);
      
      logger.info('Building block', { blockNumber, timestamp });
      
      // Get pending transactions from mempool
      const pendingTxs = await this.getPendingTransactions();
      
      logger.info('Pending transactions', { count: pendingTxs.length });
      
      
      // Build execution payload
      const payload = await this.buildPayload(
        blockNumber,
        timestamp,
        pendingTxs
      );
      
      // Submit payload to execution layer
      const payloadResult = await this.engineAPI!.newPayloadV1(payload);
      
      if (payloadResult.status !== 'VALID' && payloadResult.status !== 'ACCEPTED') {
        throw new Error(`Payload rejected: ${payloadResult.status} - ${payloadResult.validationError}`);
      }
      
      // Update fork choice
      const forkchoiceState: ForkchoiceState = {
        headBlockHash: payload.blockHash,
        safeBlockHash: payload.blockHash,
        finalizedBlockHash: this.lastBlockHash,
      };
      
      const forkchoiceResult = await this.engineAPI!.forkchoiceUpdatedV1(forkchoiceState);
      
      if (forkchoiceResult.payloadStatus.status !== 'VALID') {
        throw new Error(`Forkchoice update failed: ${forkchoiceResult.payloadStatus.status}`);
      }
      
      // Update state
      this.lastBlockHash = payload.blockHash;
      this.lastBlockNumber = blockNumber;
      
      logger.info('Block built successfully', {
        blockNumber,
        blockHash: payload.blockHash.slice(0, 10) + '...',
        transactions: pendingTxs.length,
        gasUsed: payload.gasUsed,
      });
      
    } catch (error: any) {
      logger.error('Failed to build block', {
        error: error.message,
        blockNumber: this.lastBlockNumber + 1,
      });
    }
  }
  
  /**
   * Get pending transactions from mempool
   */
  private async getPendingTransactions(): Promise<string[]> {
    try {
      // Get pending transactions
      const pendingBlock = await this.l2Provider!.send('eth_getBlockByNumber', [
        'pending',
        true,
      ]);
      
      if (pendingBlock && pendingBlock.transactions) {
        // Return raw transaction data
        return pendingBlock.transactions.map((tx: any) => {
          // Convert transaction to RLP-encoded format
          // For MVP, we'll return the transaction hash
          // In production, you need to RLP-encode the full transaction
          return tx.hash || '0x';
        });
      }
      
      return [];
    } catch (error) {
      logger.debug('No pending transactions');
      return [];
    }
  }
  
  /**
   * Build execution payload
   */
  private async buildPayload(
    blockNumber: number,
    timestamp: number,
    transactions: string[]
  ): Promise<ExecutionPayload> {
    
    // Calculate block hash (simplified - in production use proper RLP encoding)
    const blockData = ethers.concat([
      ethers.toBeHex(blockNumber, 32),
      ethers.toBeHex(timestamp, 32),
      this.lastBlockHash,
    ]);
    const blockHash = ethers.keccak256(blockData);
    
    // Build payload
    const payload: ExecutionPayload = {
      parentHash: this.lastBlockHash,
      feeRecipient: this.sequencerAddress,
      stateRoot: ethers.ZeroHash, 
      receiptsRoot: ethers.ZeroHash, // Calculated by execution layer
      logsBloom: '0x' + '0'.repeat(512), // Empty logs bloom
      prevRandao: ethers.keccak256(ethers.toUtf8Bytes(`random-${timestamp}`)),
      blockNumber: '0x' + blockNumber.toString(16),
      gasLimit: '0x1c9c380', // 30M gas
      gasUsed: '0x0', // Will be calculated
      timestamp: '0x' + timestamp.toString(16),
      extraData: ethers.hexlify(ethers.toUtf8Bytes('TeQoin L2')),
      baseFeePerGas: '0x7', // 7 wei
      blockHash: blockHash,
      transactions: transactions,
    };
    
    return payload;
  }
  
  /**
   * Stop block building
   */
  async stop(): Promise<void> {
    logService('BLOCK-BUILDER', 'Stopping...');
    
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    logService('BLOCK-BUILDER', 'Stopped');
  }
  
  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
  
  /**
   * Get current block number
   */
  getCurrentBlockNumber(): number {
    return this.lastBlockNumber;
  }
}

export default BlockBuilderService;