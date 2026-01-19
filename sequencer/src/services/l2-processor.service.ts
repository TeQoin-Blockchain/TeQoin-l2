import { ethers } from 'ethers';
import { Config } from '../types';
import { logger, logService, logDeposit } from '../utils/logger';
import { getPendingDeposits, markDepositProcessed } from '../database/models';
import { retryWithDefaults } from '../utils/retry';

// ═══════════════════════════════════════════════════════
// L2 PROCESSOR SERVICE
// Purpose: Process pending deposits on L2
// ═══════════════════════════════════════════════════════

export class L2ProcessorService {
  private provider: ethers.JsonRpcProvider | null = null;
  private wallet: ethers.Wallet | null = null;
  private contract: ethers.Contract | null = null;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  
  constructor(private config: Config) {}
  
  /**
   * Start processing deposits
   */
  async start(): Promise<void> {
    logService('L2-PROCESSOR', 'Starting...');
    
    try {
      // Connect to L2
      this.provider = new ethers.JsonRpcProvider(this.config.l2.rpcUrl);
      
      // Create wallet
      this.wallet = new ethers.Wallet(
        this.config.sequencer.privateKey,
        this.provider
      );
      
      // Create L2Bridge contract instance
      this.contract = new ethers.Contract(
        this.config.l2.contracts.bridge,
        L2_BRIDGE_ABI,
        this.wallet
      );
      
      this.isRunning = true;
      
      // Start processing loop (every 10 seconds)
      this.intervalId = setInterval(() => {
        this.processDeposits().catch((error) => {
          logger.error('Error in deposit processing loop', { error });
        });
      }, 10000);
      
      logService('L2-PROCESSOR', 'Started successfully', {
        bridgeAddress: this.config.l2.contracts.bridge,
        sequencer: this.config.sequencer.address,
      });
      
      // Process immediately on start
      await this.processDeposits();
      
    } catch (error) {
      logService('L2-PROCESSOR', 'Failed to start', { error });
      throw error;
    }
  }
  
  /**
   * Process pending deposits
   */
  private async processDeposits(): Promise<void> {
    if (!this.isRunning) return;
    
    try {
      // Get pending deposits from database
      const pendingDeposits = await getPendingDeposits(
        this.config.maxConcurrentDeposits
      );
      
      if (pendingDeposits.length === 0) {
        return;
      }
      
      logService('L2-PROCESSOR', `Processing ${pendingDeposits.length} deposits`);
      
      // Process each deposit
      for (const deposit of pendingDeposits) {
        await this.processDeposit(deposit);
      }
      
    } catch (error) {
      logger.error('Failed to process deposits', { error });
    }
  }
  
  /**
   * Process single deposit
   */
  private async processDeposit(deposit: any): Promise<void> {
    try {
      logDeposit(deposit.depositId, 'Processing on L2', {
        recipient: deposit.recipient,
        amount: deposit.amount,
      });
      
      // Call L2Bridge.processDeposit()
      const tx = await retryWithDefaults(async () => {
        return await this.contract!.processDeposit(
          deposit.tokenAddress,
          deposit.recipient,
          deposit.amount,
          deposit.depositId,
          {
            gasLimit: 200000,
          }
        );
      });
      
      logDeposit(deposit.depositId, 'Transaction sent', { hash: tx.hash });
      
      // Wait for confirmation
      const receipt = await tx.wait(1);
      
      if (receipt.status === 1) {
        // Mark as processed in database
        await markDepositProcessed(deposit.depositId, tx.hash);
        
        logDeposit(deposit.depositId, 'Processed successfully', {
          l2TxHash: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
        });
      } else {
        logger.error('Deposit transaction failed', {
          depositId: deposit.depositId,
          txHash: tx.hash,
        });
      }
      
    } catch (error) {
      logger.error('Failed to process deposit', {
        depositId: deposit.depositId,
        error,
      });
    }
  }
  
  /**
   * Stop processing
   */
  async stop(): Promise<void> {
    logService('L2-PROCESSOR', 'Stopping...');
    
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    logService('L2-PROCESSOR', 'Stopped');
  }
  
  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// ═══════════════════════════════════════════════════════
// L2 BRIDGE ABI
// ═══════════════════════════════════════════════════════

const L2_BRIDGE_ABI = [
  'function processDeposit(address token, address recipient, uint256 amount, bytes32 depositId) external',
];

export default L2ProcessorService;