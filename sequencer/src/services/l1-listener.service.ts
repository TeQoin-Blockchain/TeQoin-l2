import { ethers } from 'ethers';
import { Config, DepositEvent } from '../types';
import { logger, logService } from '../utils/logger';
import { saveDeposit } from '../database/models';

// ═══════════════════════════════════════════════════════
// L1 LISTENER SERVICE
// Purpose: Listen to L1 Diamond for deposit events
// ═══════════════════════════════════════════════════════

export class L1ListenerService {
  private provider: ethers.WebSocketProvider | null = null;
  private contract: ethers.Contract | null = null;
  private isRunning: boolean = false;
  
  constructor(private config: Config) {}
  
  /**
   * Start listening to L1 deposits
   */
  async start(): Promise<void> {
    logService('L1-LISTENER', 'Starting...');
    
    try {
      // Connect to L1 via WebSocket
      this.provider = new ethers.WebSocketProvider(this.config.l1.wsUrl);
      
      // Create contract instance (BridgeFacet on Diamond)
      this.contract = new ethers.Contract(
        this.config.l1.diamondAddress,
        BRIDGE_FACET_ABI,
        this.provider
      );
      
      // Listen for Deposited events
      this.contract.on('Deposited', this.handleDeposit.bind(this));
      
      this.isRunning = true;
      logService('L1-LISTENER', 'Started successfully', {
        diamondAddress: this.config.l1.diamondAddress,
        chainId: this.config.l1.chainId,
      });
      
    } catch (error) {
      logService('L1-LISTENER', 'Failed to start', { error });
      throw error;
    }
  }
  
  /**
   * Handle deposit event from L1
   */
  private async handleDeposit(
    depositId: string,
    token: string,
    recipient: string,
    amount: bigint,
    event: ethers.Log
  ): Promise<void> {
    try {
      logService('L1-LISTENER', `Detected deposit: ${depositId.slice(0, 10)}...`, {
        token,
        recipient,
        amount: amount.toString(),
        blockNumber: event.blockNumber,
      });
      
      // Save to database
      await saveDeposit({
        depositId,
        tokenAddress: token,
        recipient,
        amount: amount.toString(),
        l1BlockNumber: BigInt(event.blockNumber),
        l1TxHash: event.transactionHash || '',
        processed: false,
      });
      
      logService('L1-LISTENER', `Deposit saved: ${depositId.slice(0, 10)}...`);
      
    } catch (error) {
      logger.error('Failed to handle deposit event', {
        depositId,
        error,
      });
    }
  }
  
  /**
   * Stop listening
   */
  async stop(): Promise<void> {
    logService('L1-LISTENER', 'Stopping...');
    
    if (this.contract) {
      this.contract.removeAllListeners();
    }
    
    if (this.provider) {
      await this.provider.destroy();
    }
    
    this.isRunning = false;
    logService('L1-LISTENER', 'Stopped');
  }
  
  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// ═══════════════════════════════════════════════════════
// BRIDGE FACET ABI (Deposited event)
// ═══════════════════════════════════════════════════════

const BRIDGE_FACET_ABI = [
  'event Deposited(bytes32 indexed depositId, address indexed token, address indexed recipient, uint256 amount)',
];

export default L1ListenerService;