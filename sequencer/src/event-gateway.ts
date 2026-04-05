import { ethers } from 'ethers';
import { logger } from './utils/logger';

const WS = require('ws');
const WebSocketServer = WS.WebSocketServer as any;
const WebSocket = WS as any;

const EVENT_GATEWAY_PORT = Number.parseInt(process.env.EVENT_GATEWAY_PORT || '3020', 10);
const L1_RPC_URL = process.env.L1_RPC_URL || '';
const L2_RPC_URL = process.env.L2_RPC_URL || 'http://127.0.0.1:8545';
const L2_BRIDGE_ADDRESS = process.env.L2_BRIDGE_ADDRESS?.toLowerCase() || '';
const L1_BRIDGE_ADDRESS = process.env.L1_DIAMOND_ADDRESS?.toLowerCase() || '';

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

const BRIDGE_EVENTS = [
  'event DepositProcessed(bytes32 indexed depositId,address indexed token,address indexed recipient,uint256 amount)',
  'event WithdrawalInitiated(bytes32 indexed withdrawalId,address indexed token,address indexed from,address to,uint256 amount,uint256 nonce)',
  'event WithdrawalCancelled(bytes32 indexed withdrawalId,address indexed user,uint256 amount)',
  'event Deposited(bytes32 indexed depositId,address indexed token,address indexed from,address to,uint256 amount,uint256 nonce)',
  'event WithdrawalQueued(bytes32 indexed withdrawalId,address indexed token,address indexed to,uint256 amount,uint256 timestamp)',
  'event WithdrawalFinalized(bytes32 indexed withdrawalId,address indexed to,uint256 amount)',
  'event WithdrawalChallenged(bytes32 indexed withdrawalId,address indexed challenger)',
  'event DepositFinalized(address indexed l1Token,address indexed l2Token,address indexed to,uint256 amount,uint256 l1DepositNonce)',
] as const;

interface GatewayEvent {
  type: string;
  chain: 'L1' | 'L2';
  blockNumber?: number;
  txHash?: string;
  address?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

const bridgeInterface = new ethers.Interface(BRIDGE_EVENTS as unknown as string[]);
const transferInterface = new ethers.Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const wss = new WebSocketServer({ port: EVENT_GATEWAY_PORT });
const l2RpcProvider = new ethers.JsonRpcProvider(L2_RPC_URL);
const l1RpcProvider = L1_RPC_URL ? new ethers.JsonRpcProvider(L1_RPC_URL) : null;
const recentEthTransfers = new Set<string>();
let nativeTransferPollTimer: NodeJS.Timeout | null = null;
let lastProcessedL2Block: number | null = null;
let lastProcessedL1BridgeBlock: number | null = null;

function rememberEthTransfer(txHash: string): boolean {
  if (recentEthTransfers.has(txHash)) {
    return false;
  }

  recentEthTransfers.add(txHash);

  if (recentEthTransfers.size > 5000) {
    const [oldest] = recentEthTransfers;
    if (oldest) {
      recentEthTransfers.delete(oldest);
    }
  }

  return true;
}

function broadcast(event: GatewayEvent): void {
  const message = JSON.stringify(event, (_k, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );

  wss.clients.forEach((client: any) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function handleTransferLog(chain: 'L1' | 'L2', log: ethers.Log): void {
  try {
    const parsed = transferInterface.parseLog({ topics: log.topics, data: log.data });

    if (!parsed) return;

    broadcast({
      type: 'token_transfer',
      chain,
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      address: log.address,
      payload: {
        token: log.address.toLowerCase(),
        from: String(parsed.args.from).toLowerCase(),
        to: String(parsed.args.to).toLowerCase(),
        value: parsed.args.value,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.debug('Failed to decode transfer log', { error: error.message });
  }
}

function handleBridgeLog(chain: 'L1' | 'L2', log: ethers.Log): void {
  try {
    const parsed = bridgeInterface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) return;

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.args.toObject())) {
      payload[key] = value;
    }

    broadcast({
      type: 'bridge_event',
      chain,
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      address: log.address,
      payload: {
        eventName: parsed.name,
        ...payload,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.debug('Failed to decode bridge log', { error: error.message });
  }
}

async function handleL2Block(blockNumber: number): Promise<void> {
  try {
    const block = await l2RpcProvider.getBlock(blockNumber, true);

    if (!block || !block.transactions.length) {
      return;
    }

    const transactions = block.transactions as unknown as readonly any[];

    for (const txOrHash of transactions) {
      const txResponse = typeof txOrHash === 'string'
        ? await l2RpcProvider.getTransaction(txOrHash)
        : txOrHash;

      if (!txResponse) {
        continue;
      }

      if (!txResponse.value || txResponse.value <= 0n) {
        continue;
      }

      if (!rememberEthTransfer(txResponse.hash)) {
        continue;
      }

      let receipt: ethers.TransactionReceipt | null = null;
      try {
        receipt = await l2RpcProvider.getTransactionReceipt(txResponse.hash);
      } catch (error: any) {
        logger.debug('Failed to fetch L2 receipt for native transfer', {
          txHash: txResponse.hash,
          error: error.message,
        });
      }

      broadcast({
        type: 'eth_transfer',
        chain: 'L2',
        blockNumber,
        txHash: txResponse.hash,
        address: txResponse.to?.toLowerCase() || undefined,
        payload: {
          from: txResponse.from?.toLowerCase(),
          to: txResponse.to?.toLowerCase() || null,
          value: txResponse.value,
          gasPrice: txResponse.gasPrice ?? null,
          gasLimit: txResponse.gasLimit ?? null,
          status: receipt?.status === 1 ? 'success' : receipt?.status === 0 ? 'failed' : 'pending',
          isContractCall: !!txResponse.data && txResponse.data !== '0x',
        },
        timestamp: new Date().toISOString(),
      });
      logger.info('[EVENT-GATEWAY] Emitted native transfer event', {
        txHash: txResponse.hash,
        blockNumber,
        from: txResponse.from?.toLowerCase(),
        to: txResponse.to?.toLowerCase() || null,
        value: txResponse.value.toString(),
      });
    }
  } catch (error: any) {
    logger.error('[EVENT-GATEWAY] Failed to process L2 block for native transfers', {
      blockNumber,
      error: error.message,
    });
  }
}

async function pollL2Events(): Promise<void> {
  try {
    const latestBlock = await l2RpcProvider.getBlockNumber();

    if (lastProcessedL2Block === null) {
      lastProcessedL2Block = latestBlock;
      return;
    }

    if (latestBlock <= lastProcessedL2Block) {
      return;
    }

    logger.info('[EVENT-GATEWAY] L2 event poll advanced', {
      fromBlock: lastProcessedL2Block + 1,
      toBlock: latestBlock,
    });

    const transferLogs = await l2RpcProvider.getLogs({
      fromBlock: lastProcessedL2Block + 1,
      toBlock: latestBlock,
      topics: [TRANSFER_TOPIC],
    });

    for (const log of transferLogs) {
      handleTransferLog('L2', log);
    }

    if (L2_BRIDGE_ADDRESS) {
      const bridgeLogs = await l2RpcProvider.getLogs({
        address: L2_BRIDGE_ADDRESS,
        fromBlock: lastProcessedL2Block + 1,
        toBlock: latestBlock,
      });

      for (const log of bridgeLogs) {
        handleBridgeLog('L2', log);
      }
    }

    for (let blockNumber = lastProcessedL2Block + 1; blockNumber <= latestBlock; blockNumber += 1) {
      await handleL2Block(blockNumber);
    }

    lastProcessedL2Block = latestBlock;
  } catch (error: any) {
    logger.error('[EVENT-GATEWAY] Native transfer poll failed', {
      error: error.message,
    });
  }
}

async function pollL1BridgeEvents(): Promise<void> {
  if (!l1RpcProvider || !L1_BRIDGE_ADDRESS) {
    return;
  }

  try {
    const latestBlock = await l1RpcProvider.getBlockNumber();

    if (lastProcessedL1BridgeBlock === null) {
      lastProcessedL1BridgeBlock = latestBlock;
      return;
    }

    if (latestBlock <= lastProcessedL1BridgeBlock) {
      return;
    }

    logger.info('[EVENT-GATEWAY] L1 bridge poll advanced', {
      fromBlock: lastProcessedL1BridgeBlock + 1,
      toBlock: latestBlock,
    });

    const bridgeLogs = await l1RpcProvider.getLogs({
      address: L1_BRIDGE_ADDRESS,
      fromBlock: lastProcessedL1BridgeBlock + 1,
      toBlock: latestBlock,
    });

    for (const log of bridgeLogs) {
      handleBridgeLog('L1', log);
    }

    lastProcessedL1BridgeBlock = latestBlock;
  } catch (error: any) {
    logger.error('[EVENT-GATEWAY] L1 bridge poll failed', {
      error: error.message,
    });
  }
}

async function start(): Promise<void> {
  logger.info('[EVENT-GATEWAY] Starting event gateway', {
    port: EVENT_GATEWAY_PORT,
    l1RpcUrl: L1_RPC_URL || 'not_configured',
    l2RpcUrl: L2_RPC_URL,
    l1BridgeAddress: L1_BRIDGE_ADDRESS || 'not_configured',
    bridgeAddress: L2_BRIDGE_ADDRESS || 'not_configured',
  });

  wss.on('connection', (ws: any) => {
    ws.send(
      JSON.stringify({
        type: 'gateway_status',
        status: 'connected',
        chain: 'L2',
        streams: ['token_transfer', 'eth_transfer', 'bridge_event'],
        upstreamChains: ['L2', ...(l1RpcProvider ? ['L1'] : [])],
        timestamp: new Date().toISOString(),
      })
    );

    ws.on('message', (data: any) => {
      const raw = typeof data === 'string' ? data : data.toString();
      if (raw === 'ping') {
        ws.send('pong');
      }
    });
  });

  lastProcessedL2Block = await l2RpcProvider.getBlockNumber();
  if (l1RpcProvider && L1_BRIDGE_ADDRESS) {
    lastProcessedL1BridgeBlock = await l1RpcProvider.getBlockNumber();
  }
  nativeTransferPollTimer = setInterval(() => {
    pollL2Events().catch((error) => {
      logger.error('[EVENT-GATEWAY] L2 event poll loop failed', {
        error: error.message,
      });
    });
    pollL1BridgeEvents().catch((error) => {
      logger.error('[EVENT-GATEWAY] L1 bridge poll loop failed', {
        error: error.message,
      });
    });
  }, 2000);

  logger.info('[EVENT-GATEWAY] Event gateway started', {
    listen: `ws://0.0.0.0:${EVENT_GATEWAY_PORT}`,
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info('[EVENT-GATEWAY] Shutting down', { signal });

  try {
    if (nativeTransferPollTimer) {
      clearInterval(nativeTransferPollTimer);
      nativeTransferPollTimer = null;
    }
    wss.close();
    try {
      await l2RpcProvider.destroy();
    } catch {}
    if (l1RpcProvider) {
      await l1RpcProvider.destroy();
    }
  } catch (error: any) {
    logger.error('[EVENT-GATEWAY] Error during shutdown', { error: error.message });
  }

  process.exit(0);
}

start().catch((error: any) => {
  logger.error('[EVENT-GATEWAY] Fatal startup error', { error: error.message });
  process.exit(1);
});

process.on('SIGINT', () => {
  shutdown('SIGINT').catch(() => process.exit(1));
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(() => process.exit(1));
});
