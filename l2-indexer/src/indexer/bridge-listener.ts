import { ethers } from 'ethers';
import config from '../config';
import logger from '../utils/logger';
import { getState, setState } from '../database/queries/state';
import {
  upsertL1DepositInitiated,
  upsertL1WithdrawalStatus,
  upsertL2DepositProcessed,
  upsertL2WithdrawalInitiated,
} from '../database/queries/bridge';

const L1_STATE_KEY = 'l1_bridge_last_block';
const L2_STATE_KEY = 'l2_bridge_last_block';

const L1_BRIDGE_ABI = [
  'event Deposited(bytes32 indexed depositId,address indexed token,address indexed from,address to,uint256 amount,uint256 nonce)',
  'event WithdrawalQueued(bytes32 indexed withdrawalId,address indexed token,address indexed to,uint256 amount,uint256 timestamp)',
  'event WithdrawalFinalized(bytes32 indexed withdrawalId,address indexed to,uint256 amount)',
];

const L2_BRIDGE_ABI = [
  'event DepositProcessed(bytes32 indexed depositId,address indexed token,address indexed recipient,uint256 amount)',
  'event WithdrawalInitiated(bytes32 indexed withdrawalId,address indexed token,address indexed from,address to,uint256 amount,uint256 nonce)',
];

export class BridgeListener {
  private isRunning = false;
  private isSyncing = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private l1Provider: ethers.JsonRpcProvider | null = null;
  private l2Provider: ethers.JsonRpcProvider | null = null;
  private l1Interface = new ethers.Interface(L1_BRIDGE_ABI);
  private l2Interface = new ethers.Interface(L2_BRIDGE_ABI);
  private chainBackoffUntilMs: Record<'l1' | 'l2', number> = { l1: 0, l2: 0 };
  private chainBackoffAttempt: Record<'l1' | 'l2', number> = { l1: 0, l2: 0 };

  async start(): Promise<void> {
    if (this.isRunning) return;

    if (!config.bridge.enabled) {
      logger.warn('Bridge listener disabled: missing L1/L2 bridge configuration');
      return;
    }

    this.l1Provider = new ethers.JsonRpcProvider(config.l1.rpcUrl);
    this.l2Provider = new ethers.JsonRpcProvider(config.l2.rpcUrl);

    this.isRunning = true;
    try {
      await this.syncOnce();
    } catch (error: any) {
      logger.error('Initial bridge sync failed; continuing in background', { error: error?.message || String(error) });
    }

    this.pollTimer = setInterval(() => {
      this.syncOnce().catch((error) => {
        logger.error('Bridge listener sync error', { error: error.message });
      });
    }, config.bridge.pollInterval);

    logger.info('Bridge listener started', {
      l1Bridge: config.bridge.l1Address,
      l2Bridges: config.bridge.l2Addresses,
      pollInterval: config.bridge.pollInterval,
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Bridge listener stopped');
  }

  isActive(): boolean {
    return this.isRunning;
  }

  private async syncOnce(): Promise<void> {
    if (!this.isRunning || this.isSyncing || !this.l1Provider || !this.l2Provider) return;

    this.isSyncing = true;
    try {
      const results = await Promise.allSettled([this.syncChain('l1'), this.syncChain('l2')]);
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          const chain = index === 0 ? 'l1' : 'l2';
          logger.error('Bridge chain sync failed', { chain, error: result.reason?.message || String(result.reason) });
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncChain(chain: 'l1' | 'l2'): Promise<void> {
    const provider = chain === 'l1' ? this.l1Provider! : this.l2Provider!;
    const stateKey = chain === 'l1' ? L1_STATE_KEY : L2_STATE_KEY;
    const startBlockConfig = chain === 'l1' ? config.bridge.startL1Block : config.bridge.startL2Block;

    if (Date.now() < this.chainBackoffUntilMs[chain]) {
      return;
    }

    try {
      const currentBlock = BigInt(await provider.getBlockNumber());
      const saved = await getState(stateKey);

      let fromBlock: bigint;
      if (saved === null) {
        fromBlock = startBlockConfig > 0 ? BigInt(startBlockConfig) : currentBlock;
      } else {
        fromBlock = BigInt(saved) + 1n;
      }

      if (fromBlock > currentBlock) {
        this.chainBackoffAttempt[chain] = 0;
        return;
      }

      const batchSize = BigInt(Math.max(1, config.bridge.batchSize));

      for (let start = fromBlock; start <= currentBlock; start += batchSize) {
        const end = start + batchSize - 1n > currentBlock ? currentBlock : start + batchSize - 1n;

        if (chain === 'l1') {
          await this.processL1Range(start, end);
        } else {
          await this.processL2Range(start, end);
        }

        await setState(stateKey, end.toString());
      }

      this.chainBackoffAttempt[chain] = 0;
    } catch (error: any) {
      if (this.isRateLimitError(error)) {
        this.applyBackoff(chain, error);
        return;
      }
      throw error;
    }
  }

  private async processL1Range(fromBlock: bigint, toBlock: bigint): Promise<void> {
    if (!this.l1Provider) return;

    const logs = await this.l1Provider.getLogs({
      address: config.bridge.l1Address,
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
    });

    const sorted = logs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index));
    const tsCache = new Map<number, bigint>();

    for (const log of sorted) {
      let parsed: any;
      try {
        parsed = this.l1Interface.parseLog({ topics: log.topics, data: log.data });
      } catch {
        continue;
      }
      if (!parsed) continue;

      const timestamp = await this.getBlockTimestamp(this.l1Provider, log.blockNumber, tsCache);

      if (parsed.name === 'Deposited') {
        await upsertL1DepositInitiated({
          bridgeId: String(parsed.args.depositId).toLowerCase(),
          tokenAddress: String(parsed.args.token).toLowerCase(),
          fromAddress: String(parsed.args.from).toLowerCase(),
          toAddress: String(parsed.args.to).toLowerCase(),
          amount: parsed.args.amount.toString(),
          l1TxHash: log.transactionHash,
          l1BlockNumber: BigInt(log.blockNumber),
          l1Timestamp: timestamp,
        });
        continue;
      }

      if (parsed.name === 'WithdrawalQueued') {
        await upsertL1WithdrawalStatus({
          bridgeId: String(parsed.args.withdrawalId).toLowerCase(),
          status: 'queued',
          tokenAddress: String(parsed.args.token).toLowerCase(),
          toAddress: String(parsed.args.to).toLowerCase(),
          amount: parsed.args.amount.toString(),
          l1TxHash: log.transactionHash,
          l1BlockNumber: BigInt(log.blockNumber),
          l1Timestamp: timestamp,
        });
        continue;
      }

      if (parsed.name === 'WithdrawalFinalized') {
        await upsertL1WithdrawalStatus({
          bridgeId: String(parsed.args.withdrawalId).toLowerCase(),
          status: 'finalized',
          toAddress: String(parsed.args.to).toLowerCase(),
          amount: parsed.args.amount.toString(),
          l1TxHash: log.transactionHash,
          l1BlockNumber: BigInt(log.blockNumber),
          l1Timestamp: timestamp,
        });
      }
    }
  }

  private async processL2Range(fromBlock: bigint, toBlock: bigint): Promise<void> {
    if (!this.l2Provider) return;

    const logs = await this.l2Provider.getLogs({
      address: config.bridge.l2Addresses,
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
    });

    const sorted = logs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index));
    const tsCache = new Map<number, bigint>();

    for (const log of sorted) {
      let parsed: any;
      try {
        parsed = this.l2Interface.parseLog({ topics: log.topics, data: log.data });
      } catch {
        continue;
      }
      if (!parsed) continue;

      const timestamp = await this.getBlockTimestamp(this.l2Provider, log.blockNumber, tsCache);

      if (parsed.name === 'DepositProcessed') {
        await upsertL2DepositProcessed({
          bridgeId: String(parsed.args.depositId).toLowerCase(),
          tokenAddress: String(parsed.args.token).toLowerCase(),
          toAddress: String(parsed.args.recipient).toLowerCase(),
          amount: parsed.args.amount.toString(),
          l2TxHash: log.transactionHash,
          l2BlockNumber: BigInt(log.blockNumber),
          l2Timestamp: timestamp,
        });
        continue;
      }

      if (parsed.name === 'WithdrawalInitiated') {
        await upsertL2WithdrawalInitiated({
          bridgeId: String(parsed.args.withdrawalId).toLowerCase(),
          tokenAddress: String(parsed.args.token).toLowerCase(),
          fromAddress: String(parsed.args.from).toLowerCase(),
          toAddress: String(parsed.args.to).toLowerCase(),
          amount: parsed.args.amount.toString(),
          l2TxHash: log.transactionHash,
          l2BlockNumber: BigInt(log.blockNumber),
          l2Timestamp: timestamp,
        });
      }
    }
  }


  private isRateLimitError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    const code = error?.code;
    const nestedCode = error?.error?.code;

    return (
      code === 429 ||
      code === -32005 ||
      nestedCode === 429 ||
      nestedCode === -32005 ||
      message.includes('too many requests') ||
      message.includes('rate limit') ||
      message.includes('rate exceeded')
    );
  }

  private applyBackoff(chain: 'l1' | 'l2', error: any): void {
    this.chainBackoffAttempt[chain] += 1;
    const delayMs = Math.min(120000, 5000 * (2 ** (this.chainBackoffAttempt[chain] - 1)));
    this.chainBackoffUntilMs[chain] = Date.now() + delayMs;

    logger.warn('Bridge sync rate limited; backing off', {
      chain,
      delayMs,
      attempt: this.chainBackoffAttempt[chain],
      error: error?.message || String(error),
    });
  }

  private async getBlockTimestamp(
    provider: ethers.JsonRpcProvider,
    blockNumber: number,
    cache: Map<number, bigint>
  ): Promise<bigint> {
    const cached = cache.get(blockNumber);
    if (cached !== undefined) return cached;

    const block = await provider.getBlock(blockNumber);
    const ts = BigInt(block?.timestamp || 0);
    cache.set(blockNumber, ts);
    return ts;
  }
}
