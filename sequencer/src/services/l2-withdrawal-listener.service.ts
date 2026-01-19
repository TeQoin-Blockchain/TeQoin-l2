import { ethers } from 'ethers';
import { Config } from '../types';
import { logger, logService, logWithdrawal } from '../utils/logger';
import { saveWithdrawal } from '../database/models';

// ═══════════════════════════════════════════════════════
// L2 WITHDRAWAL LISTENER SERVICE
// Purpose: Listen to L2 for withdrawal events
// ═══════════════════════════════════════════════════════

export class L2WithdrawalListenerService {
  private provider: ethers.WebSocketProvider | null = null;
  private contract: ethers.Contract | null = null;
  private isRunning: boolean = false;
  
  constructor(private config: Config) {}
  
  /**
   * Start listening to L2 withdrawals
   */
  async start(): Promise<void> {
    logService('L2-WITHDRAWAL-LISTENER', 'Starting...');
    
    try {
      // Connect to L2 via WebSocket
      this.provider = new ethers.WebSocketProvider(this.config.l2.wsUrl);
      
      // Create L2Bridge contract instance
      this.contract = new ethers.Contract(
        this.config.l2.contracts.bridge,
        L2_BRIDGE_ABI,
        this.provider
      );
      
      // Listen for WithdrawalInitiated events
      this.contract.on('WithdrawalInitiated', this.handleWithdrawal.bind(this));
      
      this.isRunning = true;
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
   * Handle withdrawal event from L2
   */
  private async handleWithdrawal(
    withdrawalId: string,
    token: string,
    from: string,
    to: string,
    amount: bigint,
    nonce: bigint,
    event: ethers.Log
  ): Promise<void> {
    try {
      logWithdrawal(withdrawalId, 'Detected', {
        token,
        from,
        to,
        amount: amount.toString(),
        nonce: nonce.toString(),
        blockNumber: event.blockNumber,
      });
      
      // Save to database
      await saveWithdrawal({
        withdrawalId,
        tokenAddress: token,
        sender: from,
        recipient: to,
        amount: amount.toString(),
        l2BlockNumber: BigInt(event.blockNumber),
        l2TxHash: event.transactionHash || '',
        queued: false,
        finalized: false,
      });
      
      logWithdrawal(withdrawalId, 'Saved to database');
      
    } catch (error) {
      logger.error('Failed to handle withdrawal event', {
        withdrawalId,
        error,
      });
    }
  }
  
  /**
   * Stop listening
   */
  async stop(): Promise<void> {
    logService('L2-WITHDRAWAL-LISTENER', 'Stopping...');
    
    if (this.contract) {
      this.contract.removeAllListeners();
    }
    
    if (this.provider) {
      await this.provider.destroy();
    }
    
    this.isRunning = false;
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