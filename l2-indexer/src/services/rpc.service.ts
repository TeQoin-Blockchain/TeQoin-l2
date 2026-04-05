import { ethers } from 'ethers';
import config from '../config';
import logger from '../utils/logger';
import { Block, Transaction, Log } from '../types';

export class RPCService {
  private provider: ethers.JsonRpcProvider;
  private wsProvider: ethers.WebSocketProvider | null = null;
  private contractCache = new Map<string, { isContract: boolean; expiresAt: number }>();
  private tokenMetaCache = new Map<string, { name: string | null; symbol: string | null; decimals: number | null; expiresAt: number }>();

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.l2.rpcUrl);
    logger.info('RPC Service initialized', { rpcUrl: config.l2.rpcUrl });
  }

  async connectWebSocket(): Promise<void> {
    try {
      this.wsProvider = new ethers.WebSocketProvider(config.l2.wsUrl);
      logger.info('WebSocket connected', { wsUrl: config.l2.wsUrl });
    } catch (error: any) {
      logger.error('WebSocket connection failed', { error: error.message });
      throw error;
    }
  }

  async getCurrentBlockNumber(): Promise<bigint> {
    return BigInt(await this.provider.getBlockNumber());
  }

  async getBlock(numberOrHash: number | bigint | string): Promise<Block | null> {
    try {
      const block = await this.provider.getBlock(numberOrHash, true);
      if (!block) return null;

      return {
        number: BigInt(block.number),
        hash: block.hash!,
        parentHash: block.parentHash,
        timestamp: BigInt(block.timestamp),
        miner: block.miner!,
        gasUsed: block.gasUsed,
        gasLimit: block.gasLimit,
        transactionCount: block.transactions.length,
      };
    } catch (error: any) {
      logger.error('Failed to fetch block', { numberOrHash, error: error.message });
      return null;
    }
  }

  async getTransactionsInBlock(blockNumber: bigint): Promise<Transaction[]> {
    try {
      const block = await this.provider.getBlock(Number(blockNumber), true);
      if (!block || !block.prefetchedTransactions) return [];

      const transactions: Transaction[] = [];

      for (let i = 0; i < block.prefetchedTransactions.length; i++) {
        const tx = block.prefetchedTransactions[i];
        const receipt = await this.provider.getTransactionReceipt(tx.hash);

        if (!receipt) continue;

        transactions.push({
          hash: tx.hash,
          blockNumber: BigInt(block.number),
          transactionIndex: tx.index,
          fromAddress: tx.from.toLowerCase(),
          toAddress: tx.to?.toLowerCase() || null,
          value: tx.value.toString(),
          gasPrice: tx.gasPrice || 0n,
          gasUsed: receipt.gasUsed,
          gasLimit: tx.gasLimit,
          effectiveGasPrice: receipt.gasPrice ?? tx.gasPrice ?? 0n,
          maxFeePerGas: tx.maxFeePerGas ?? null,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
          baseFeePerGas: block.baseFeePerGas ?? null,
          txType: tx.type,
          input: tx.data,
          nonce: BigInt(tx.nonce),
          status: receipt.status === 1,
          timestamp: BigInt(block.timestamp),
        });
      }

      return transactions;
    } catch (error: any) {
      logger.error('Failed to fetch transactions', { blockNumber, error: error.message });
      return [];
    }
  }

  async getLogsInBlock(blockNumber: bigint): Promise<Log[]> {
    try {
      const logs = await this.provider.getLogs({
        fromBlock: Number(blockNumber),
        toBlock: Number(blockNumber),
      });

      return logs.map((log) => ({
        transactionHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
        address: log.address.toLowerCase(),
        topic0: log.topics[0] || null,
        topic1: log.topics[1] || null,
        topic2: log.topics[2] || null,
        topic3: log.topics[3] || null,
        data: log.data,
      }));
    } catch (error: any) {
      logger.error('Failed to fetch logs', { blockNumber, error: error.message });
      return [];
    }
  }

  async getTransaction(hash: string): Promise<Transaction | null> {
    try {
      const tx = await this.provider.getTransaction(hash);
      const receipt = await this.provider.getTransactionReceipt(hash);

      if (!tx || !receipt) return null;

      const block = await this.provider.getBlock(receipt.blockNumber);
      if (!block) return null;

      return {
        hash: tx.hash,
        blockNumber: BigInt(receipt.blockNumber),
        transactionIndex: receipt.index,
        fromAddress: tx.from.toLowerCase(),
        toAddress: tx.to?.toLowerCase() || null,
        value: tx.value.toString(),
        gasPrice: tx.gasPrice || 0n,
        gasUsed: receipt.gasUsed,
        gasLimit: tx.gasLimit,
        effectiveGasPrice: receipt.gasPrice ?? tx.gasPrice ?? 0n,
        maxFeePerGas: tx.maxFeePerGas ?? null,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
        baseFeePerGas: block.baseFeePerGas ?? null,
        txType: tx.type,
        input: tx.data,
        nonce: BigInt(tx.nonce),
        status: receipt.status === 1,
        timestamp: BigInt(block.timestamp),
      };
    } catch (error: any) {
      logger.error('Failed to fetch transaction', { hash, error: error.message });
      return null;
    }
  }

  async isContractAddress(address: string): Promise<boolean> {
    try {
      if (!ethers.isAddress(address)) return false;

      const key = address.toLowerCase();
      const now = Date.now();
      const cached = this.contractCache.get(key);

      if (cached && cached.expiresAt > now) {
        return cached.isContract;
      }

      const code = await this.provider.getCode(address);
      const isContract = code !== '0x';

      this.contractCache.set(key, {
        isContract,
        expiresAt: now + 5 * 60 * 1000,
      });

      return isContract;
    } catch (error: any) {
      logger.error('Failed to check contract code', { address, error: error.message });
      return false;
    }
  }

  async getTokenMetadata(address: string): Promise<{ name: string | null; symbol: string | null; decimals: number | null }> {
    if (!ethers.isAddress(address)) {
      return { name: null, symbol: null, decimals: null };
    }

    const key = address.toLowerCase();
    const now = Date.now();
    const cached = this.tokenMetaCache.get(key);
    if (cached && cached.expiresAt > now) {
      return { name: cached.name, symbol: cached.symbol, decimals: cached.decimals };
    }

    const abi = [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
    ];

    const contract = new ethers.Contract(address, abi, this.provider);

    let name: string | null = null;
    let symbol: string | null = null;
    let decimals: number | null = null;

    try {
      name = await contract.name();
    } catch {}
    try {
      symbol = await contract.symbol();
    } catch {}
    try {
      const d = await contract.decimals();
      if (typeof d === 'number') {
        decimals = d;
      } else if (typeof d === 'bigint') {
        decimals = Number(d);
      }
    } catch {}

    this.tokenMetaCache.set(key, {
      name,
      symbol,
      decimals,
      expiresAt: now + 6 * 60 * 60 * 1000,
    });

    return { name, symbol, decimals };
  }

  onBlock(callback: (blockNumber: bigint) => void): void {
    if (!this.wsProvider) {
      logger.error('WebSocket not connected. Call connectWebSocket() first.');
      return;
    }

    this.wsProvider.on('block', (blockNumber: number) => {
      callback(BigInt(blockNumber));
    });
  }

  async close(): Promise<void> {
    if (this.wsProvider) {
      await this.wsProvider.destroy();
      logger.info('WebSocket disconnected');
    }
  }
}

export default new RPCService();
