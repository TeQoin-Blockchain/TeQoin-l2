import { ethers } from 'ethers';
import { Config, Withdrawal } from '../types';
import { getQueuedUnfinalizedWithdrawals, markWithdrawalFinalized } from '../database/models';
import { logger, logService, logWithdrawal } from '../utils/logger';

const L1_BRIDGE_ABI = [
  'function finalizeWithdrawal(bytes32 withdrawalId) external',
];

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;
const CHALLENGE_PERIOD_SECONDS = BigInt(process.env.WITHDRAWAL_CHALLENGE_PERIOD_SECONDS || '86400');

export interface WithdrawalFinalizerHealth {
  pollIntervalMs: number;
  challengePeriodSeconds: number;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  inFlightCount: number;
}

export class WithdrawalFinalizerService {
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Wallet | null = null;
  private contract: ethers.Contract | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;
  private inFlight = new Set<string>();
  private lastRunAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastErrorMessage: string | null = null;

  constructor(private config: Config) {}

  async start(): Promise<void> {
    logService('WITHDRAWAL-FINALIZER', 'Starting...');

    this.provider = new ethers.JsonRpcProvider(this.config.l1.rpcUrl);
    this.signer = new ethers.Wallet(this.config.sequencer.privateKey, this.provider);
    this.contract = new ethers.Contract(
      this.config.l1.diamondAddress,
      L1_BRIDGE_ABI,
      this.signer
    );

    this.isRunning = true;

    await this.processEligibleWithdrawals();

    this.pollInterval = setInterval(() => {
      this.processEligibleWithdrawals().catch((error) => {
        logger.error('Withdrawal finalizer poll failed', { error: error?.message });
      });
    }, DEFAULT_POLL_INTERVAL_MS);

    logService('WITHDRAWAL-FINALIZER', 'Started successfully', {
      l1Bridge: this.config.l1.diamondAddress,
      relayer: this.signer.address,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    });
  }

  async stop(): Promise<void> {
    logService('WITHDRAWAL-FINALIZER', 'Stopping...');
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.inFlight.clear();
    logService('WITHDRAWAL-FINALIZER', 'Stopped');
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getHealth(): WithdrawalFinalizerHealth {
    return {
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      challengePeriodSeconds: Number(CHALLENGE_PERIOD_SECONDS),
      lastRunAt: this.lastRunAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      inFlightCount: this.inFlight.size,
    };
  }

  private async processEligibleWithdrawals(): Promise<void> {
    if (!this.isRunning || this.isProcessing || !this.contract) {
      return;
    }

    this.isProcessing = true;
    this.lastRunAt = new Date();

    try {
      const withdrawals = await getQueuedUnfinalizedWithdrawals(DEFAULT_BATCH_SIZE);

      if (withdrawals.length === 0) {
        return;
      }

      for (const withdrawal of withdrawals) {
        if (!this.isRunning) {
          break;
        }

        if (this.inFlight.has(withdrawal.withdrawalId)) {
          continue;
        }

        this.inFlight.add(withdrawal.withdrawalId);

        try {
          await this.handleWithdrawal(withdrawal);
        } finally {
          this.inFlight.delete(withdrawal.withdrawalId);
        }
      }

      this.lastSuccessAt = new Date();
      this.lastErrorAt = null;
      this.lastErrorMessage = null;
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleWithdrawal(withdrawal: Withdrawal): Promise<void> {
    if (!this.contract) {
      return;
    }

    try {
      if (!withdrawal.queuedAt) {
        logWithdrawal(withdrawal.withdrawalId, 'Skipped finalization because queued_at is missing');
        return;
      }

      const queuedTimestamp = BigInt(Math.floor(withdrawal.queuedAt.getTime() / 1000));
      const challengePeriodEndsAt = queuedTimestamp + CHALLENGE_PERIOD_SECONDS;
      const now = BigInt(Math.floor(Date.now() / 1000));

      if (now < challengePeriodEndsAt) {
        return;
      }

      logWithdrawal(withdrawal.withdrawalId, 'Finalizing on L1', {
        token: withdrawal.tokenAddress,
        recipient: withdrawal.recipient,
        amount: withdrawal.amount,
      });

      const tx = await this.contract.finalizeWithdrawal(withdrawal.withdrawalId);
      const receipt = await tx.wait();

      if (receipt?.status !== 1) {
        throw new Error('Finalize withdrawal transaction failed');
      }

      await markWithdrawalFinalized(withdrawal.withdrawalId, receipt.hash);
      logWithdrawal(withdrawal.withdrawalId, 'Finalized successfully on L1', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      });
    } catch (error: any) {
      const message = error?.message || '';

      if (message.includes('Already finalized') || message.includes('Already processed')) {
        await markWithdrawalFinalized(withdrawal.withdrawalId);
        logWithdrawal(withdrawal.withdrawalId, 'Already finalized on L1, synced local state');
        return;
      }

      if (message.includes('Withdrawal challenged')) {
        logWithdrawal(withdrawal.withdrawalId, 'Skipped finalization because withdrawal is challenged');
        return;
      }

      if (message.includes('Challenge period not over')) {
        return;
      }

      this.lastErrorAt = new Date();
      this.lastErrorMessage = message;
      logger.error('Failed to finalize withdrawal', {
        withdrawalId: withdrawal.withdrawalId,
        error: message,
      });
    }
  }
}

export default WithdrawalFinalizerService;
