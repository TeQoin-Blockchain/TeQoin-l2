import { ethers } from 'ethers';
import { Config, DepositEvent } from '../types';
import { logger, logService } from '../utils/logger';
import { getLastDepositBlock, saveDeposit } from '../database/models';
import { retryWithDefaults } from '../utils/retry';

// ═══════════════════════════════════════════════════════
// L1 LISTENER SERVICE
// Purpose: Listen to L1 Diamond for deposit events
// ═══════════════════════════════════════════════════════

export class L1ListenerService {
  private provider: ethers.WebSocketProvider | null = null;
  private contract: ethers.Contract | null = null;
  private isRunning: boolean = false;
  private websocket: any = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private stopped: boolean = false;
  
  constructor(private config: Config) {}
  
  /**
   * Start listening to L1 deposits
   */
  async start(): Promise<void> {
    logService('L1-LISTENER', 'Starting...');
    
    try {
      this.stopped = false;
      await this.connect();
      
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
    from: string,
    to: string,
    amount: bigint,
    nonce: bigint,
    event: ethers.Log
  ): Promise<void> {
    try {
      logService('L1-LISTENER', `Detected deposit: ${depositId.slice(0, 10)}...`, {
        token,
        from,
        to,
        nonce: nonce.toString(),
        amount: amount.toString(),
        blockNumber: event.blockNumber,
      });
      
      // Save to database
      await saveDeposit({
        depositId,
        tokenAddress: token,
        recipient: to,
        amount: amount.toString(),
        l1BlockNumber: event.blockNumber ? BigInt(event.blockNumber) : 0n,
        l1TxHash: event.transactionHash || '',
        processed: false,
      });
      
      logService('L1-LISTENER', `Deposit saved: ${depositId.slice(0, 10)}...`);
      
    } catch (error) {
      const errorMesssage = error instanceof Error ? error.message : 'Unknown message';
      logger.error('Failed to handle deposit event', {
        depositId,
        errorMessage : errorMesssage
      });
    }
  }
  
  /**
   * Stop listening
   */
  async stop(): Promise<void> {
    logService('L1-LISTENER', 'Stopping...');
    this.stopped = true;
    this.clearReconnectTimer();
    await this.cleanup();
    logService('L1-LISTENER', 'Stopped');
  }
  
  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Capture websocket-level errors so they don't bubble as uncaught exceptions
   */
  private attachWebsocketHandlers(): void {
    const ws = (this.provider as any)?._websocket;
    if (!ws || typeof ws.on !== 'function') {
      return;
    }

    this.websocket = ws;

    ws.on('error', (error: unknown) => {
      logger.error('L1 websocket error', {
        ...(error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { error: String(error) }),
      });
      this.scheduleReconnect('error');
    });

    ws.on('close', (code: number, reason: string) => {
      logger.warn('L1 websocket closed', { code, reason });
      this.isRunning = false;
      this.scheduleReconnect('close');
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    // Connect to L1 via WebSocket
    this.provider = new ethers.WebSocketProvider(this.config.l1.wsUrl);
    this.attachWebsocketHandlers();

    // Create contract instance (BridgeFacet on Diamond)
    this.contract = new ethers.Contract(
      this.config.l1.diamondAddress,
      BRIDGE_FACET_ABI,
      this.provider
    );

    // Listen for Deposited events
    this.contract.on('Deposited', this.handleDeposit.bind(this));

    this.isRunning = true;
    this.reconnectAttempts = 0;
    logService('L1-LISTENER', 'Started successfully', {
      diamondAddress: this.config.l1.diamondAddress,
      chainId: this.config.l1.chainId,
    });

    this.backfillDeposits().catch((error) => {
      logService('L1-LISTENER', 'Backfill failed', { error });
    });
  }

  private scheduleReconnect(trigger: 'error' | 'close'): void {
    if (this.stopped || this.reconnectTimer) return;

    const attempt = Math.min(this.reconnectAttempts, 6);
    const delayMs = Math.min(30000, 1000 * Math.pow(2, attempt));
    this.reconnectAttempts += 1;

    logService('L1-LISTENER', 'Reconnecting...', { trigger, delayMs, attempt });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.cleanup();
      try {
        await this.connect();
      } catch (error) {
        logService('L1-LISTENER', 'Reconnect failed', { error });
        this.scheduleReconnect('error');
      }
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async cleanup(): Promise<void> {
    if (this.contract) {
      this.contract.removeAllListeners();
      this.contract = null;
    }

    if (this.provider) {
      await this.provider.destroy();
      this.provider = null;
    }

    this.websocket = null;
    this.isRunning = false;
  }

  private async backfillDeposits(): Promise<void> {
    if (!this.provider || !this.contract) return;

    const httpProvider = new ethers.JsonRpcProvider(this.config.l1.rpcUrl);
    const httpContract = new ethers.Contract(
      this.config.l1.diamondAddress,
      BRIDGE_FACET_ABI,
      httpProvider
    );

    const latestBlock = await retryWithDefaults(() => httpProvider.getBlockNumber());
    const lastBlock = await getLastDepositBlock();
    const fromBlock = lastBlock > 0n ? Number(lastBlock + 1n) : Math.max(latestBlock - 50000, 0);

    if (fromBlock > latestBlock) {
      return;
    }

    const filter = httpContract.filters.Deposited();
    const step = 2000;

    logService('L1-LISTENER', 'Backfill starting', { fromBlock, latestBlock });

    for (let start = fromBlock; start <= latestBlock; start += step) {
      const end = Math.min(start + step - 1, latestBlock);
      const events = await retryWithDefaults(() =>
        httpContract.queryFilter(filter, start, end)
      );

      for (const event of events) {
        const parsed = httpContract.interface.parseLog(event as ethers.Log);
        if (!parsed) {
          continue;
        }
        const args = parsed.args as unknown as {
          depositId: string;
          token: string;
          from: string;
          to: string;
          amount: bigint;
          nonce: bigint;
        };

        await this.handleDeposit(
          args.depositId,
          args.token,
          args.from,
          args.to,
          args.amount,
          args.nonce,
          event as unknown as ethers.Log
        );
      }
    }

    logService('L1-LISTENER', 'Backfill complete', { fromBlock, latestBlock });
  }
}

// ═══════════════════════════════════════════════════════
// BRIDGE FACET ABI (Deposited event)
// ═══════════════════════════════════════════════════════

const BRIDGE_FACET_ABI = [
'event Deposited(bytes32 indexed depositId, address indexed token, address indexed from, address to, uint256 amount, uint256 nonce)'
];

export default L1ListenerService;
