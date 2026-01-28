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
  
  private async buildAndSubmitBlock(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const blockNumber = this.lastBlockNumber + 1;
      const timestamp = Math.floor(Date.now() / 1000);

      logger.info('Building block', { blockNumber, timestamp });

      //Geth Build Block
      const payloadAttributes = {
        timestamp: ethers.toBeHex(timestamp),
        prevRandao: ethers.keccak256(ethers.toUtf8Bytes(`random-${timestamp}`)),
        suggestedFeeRecipient: this.sequencerAddress,
        withdrawals: [],
      };

      const forkchoiceState: ForkchoiceState = {
        headBlockHash: this.lastBlockHash,
        safeBlockHash: this.lastBlockHash,
        finalizedBlockHash: this.lastBlockHash,
      };

      logger.debug('Requesting Geth to build block');
    
      const buildResult = await this.engineAPI!.forkchoiceUpdatedV2(
        forkchoiceState,
        payloadAttributes
      );

      if (!buildResult.payloadId) {
        throw new Error('No payload ID returned');
      }

      logger.debug('Build request accepted', { payloadId: buildResult.payloadId });

    // WAIT FOR GETH TO BUILD IT 
      await new Promise(resolve => setTimeout(resolve, 500));

    // GET THE PAYLOAD GETH BUILT
      const payloadResponse = await this.engineAPI!.getPayloadV2(buildResult.payloadId);
      const payload = payloadResponse.executionPayload;

      logger.debug('Payload retrieved', {
        blockNumber: payload.blockNumber,
        blockHash: payload.blockHash.slice(0, 10) + '...',
        transactions: payload.transactions.length,
      });

    //  SUBMIT THE PAYLOAD
      const payloadResult = await this.engineAPI!.newPayloadV2(payload);

      if (payloadResult.status !== 'VALID' && payloadResult.status !== 'ACCEPTED') {
        throw new Error(`Payload rejected: ${payloadResult.status}`);
      }

      logger.debug('Payload accepted', { status: payloadResult.status });

    // UPDATE FORKCHOICE TO FINALIZ
      const finalForkchoice: ForkchoiceState = {
        headBlockHash: payload.blockHash,
        safeBlockHash: payload.blockHash,
        finalizedBlockHash: this.lastBlockHash,
      };

      const finalResult = await this.engineAPI!.forkchoiceUpdatedV2(finalForkchoice);

      if (finalResult.payloadStatus.status !== 'VALID') {
        throw new Error(`Forkchoice failed: ${finalResult.payloadStatus.status}`);
      }

    // UPDATE OUR STATE
      this.lastBlockHash = payload.blockHash;
      this.lastBlockNumber = parseInt(payload.blockNumber, 16);

      logger.info('Block built successfully', {
        blockNumber: this.lastBlockNumber,
        blockHash: payload.blockHash.slice(0, 10) + '...',
        transactions: payload.transactions.length,
      });

    } catch (error: any) {
      logger.error('Failed to build block', {
        error: error.message,
        blockNumber: this.lastBlockNumber + 1,
      });
    }
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