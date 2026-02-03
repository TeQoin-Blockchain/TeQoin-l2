import { ethers } from 'ethers';
import { Config } from '../types';
import { logger, logService, logWithdrawal } from '../utils/logger';
import { saveWithdrawal } from '../database/models';

// ═══════════════════════════════════════════════════════
// L2 WITHDRAWAL LISTENER SERVICE (FIXED - USING POLLING)
// Purpose: Listen to L2 for withdrawal events
// ═══════════════════════════════════════════════════════

export class L2WithdrawalListenerService {
  private provider: ethers.JsonRpcProvider | null = null;
  private contract: ethers.Contract | null = null;
  private isRunning: boolean = false;
  private lastProcessedBlock: number = 0;
  private pollInterval: NodeJS.Timeout | null = null;
  
  constructor(private config: Config) {}
  
  /**
   * Start listening to L2 withdrawals using polling
   */
  async start(): Promise<void> {
    logService('L2-WITHDRAWAL-LISTENER', 'Starting...');
    
    try {
      // Use HTTP provider instead of WebSocket for queryFilter
      this.provider = new ethers.JsonRpcProvider(this.config.l2.rpcUrl);
      
      // Create L2Bridge contract instance
      this.contract = new ethers.Contract(
        this.config.l2.contracts.bridge,
        L2_BRIDGE_ABI,
        this.provider
      );
      
      // Get current block to start from
      this.lastProcessedBlock = await this.provider.getBlockNumber();
      
      logService('L2-WITHDRAWAL-LISTENER', `Starting from block ${this.lastProcessedBlock}`);
      
      this.isRunning = true;
      
      // Poll for new blocks every 3 seconds
      this.pollInterval = setInterval(() => {
        this.pollForWithdrawals().catch((error) => {
          logger.error('Error polling for withdrawals', { error: error?.message });
        });
      }, 3000);
      
      logService('L2-WITHDRAWAL-LISTENER', 'Started successfully', {
        bridgeAddress: this.config.l2.contracts.bridge,
        chainId: this.config.l2.chainId,
      });
      
    } catch (error) {
      logService('L2-WITHDRAWAL-LISTENER', 'Failed to start', { error });
      throw error;
    }
  }
  
  /**
   * Poll for new withdrawal events
   */
  private async pollForWithdrawals(): Promise<void> {
    if (!this.isRunning || !this.provider || !this.contract) return;
    
    try {
      const currentBlock = await this.provider.getBlockNumber();
      
      // If no new blocks, return
      if (currentBlock <= this.lastProcessedBlock) {
        return;
      }
      
      // Query withdrawal events from last processed to current block
      const filter = this.contract.filters.WithdrawalInitiated();
      const events = await this.contract.queryFilter(
        filter,
        this.lastProcessedBlock + 1,
        currentBlock
      );
      
      if (events.length > 0) {
        logService('L2-WITHDRAWAL-LISTENER', `Found ${events.length} withdrawal(s) in blocks ${this.lastProcessedBlock + 1}-${currentBlock}`);
      }
      
      // Process each event
      for (const event of events) {
        await this.handleWithdrawalEvent(event as ethers.EventLog);
      }
      
      // Update last processed block
      this.lastProcessedBlock = currentBlock;
      
    } catch (error: any) {
      logger.error('Error polling for withdrawals', {
        error: error?.message,
        lastBlock: this.lastProcessedBlock,
      });
    }
  }
  
  /**
   * Handle withdrawal event (from queryFilter - always has full data!)
   */
  private async handleWithdrawalEvent(event: ethers.EventLog): Promise<void> {
    try {
      const { withdrawalId, token, from, to, amount, nonce } = event.args;
      
      // With queryFilter, blockNumber and txHash are ALWAYS available!
      const blockNumber = event.blockNumber;
      const txHash = event.transactionHash;
      
      logWithdrawal(withdrawalId, 'Detected', {
        token,
        from,
        to,
        amount: amount.toString(),
        nonce: nonce.toString(),
        blockNumber,
        txHash,
      });
      
      // Save to database
      await saveWithdrawal({
        withdrawalId,
        tokenAddress: token,
        sender: from,
        recipient: to,
        amount: amount.toString(),
        l2BlockNumber: BigInt(blockNumber),
        l2TxHash: txHash,
        queued: false,
        finalized: false,
      });
      
      logWithdrawal(withdrawalId, 'Saved to database');
      
    } catch (error: any) {
      logger.error('Failed to handle withdrawal event', {
        error: error?.message,
        stack: error?.stack,
      });
    }
  }
  
  /**
   * Stop listening
   */
  async stop(): Promise<void> {
    logService('L2-WITHDRAWAL-LISTENER', 'Stopping...');
    
    this.isRunning = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    logService('L2-WITHDRAWAL-LISTENER', 'Stopped');
  }
  
  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// ═══════════════════════════════════════════════════════
// L2 BRIDGE ABI (WithdrawalInitiated event)
// ═══════════════════════════════════════════════════════

const L2_BRIDGE_ABI = [
  'event WithdrawalInitiated(bytes32 indexed withdrawalId, address indexed token, address indexed from, address to, uint256 amount, uint256 nonce)',
];

export default L2WithdrawalListenerService;