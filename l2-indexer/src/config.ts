import dotenv from 'dotenv';

dotenv.config();

const l1RpcUrl = process.env.L1_RPC_URL || '';
const l1BridgeAddress = (process.env.L1_BRIDGE_ADDRESS || process.env.L1_DIAMOND_ADDRESS || '').trim().toLowerCase();
const l2BridgeAddress = (process.env.L2_BRIDGE_ADDRESS || '').trim().toLowerCase();
const l2BridgeAddresses = (
  process.env.L2_BRIDGE_ADDRESSES ||
  (l2BridgeAddress ? l2BridgeAddress : '')
)
  .split(',')
  .map((address) => address.trim().toLowerCase())
  .filter(Boolean);

const bridgeEnabled = Boolean(l1RpcUrl && l1BridgeAddress && l2BridgeAddresses.length > 0);

export const config = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://indexer:indexer_password@localhost:5433/l2_indexer',
  },
  l1: {
    rpcUrl: l1RpcUrl,
    chainId: parseInt(process.env.L1_CHAIN_ID || '11155111'),
  },
  l2: {
    rpcUrl: process.env.L2_RPC_URL || 'http://localhost:8545',
    wsUrl: process.env.L2_WS_URL || 'ws://localhost:8546',
    chainId: parseInt(process.env.L2_CHAIN_ID || '420377'),
  },
  bridge: {
    enabled: bridgeEnabled,
    l1Address: l1BridgeAddress,
    l2Address: l2BridgeAddress,
    l2Addresses: l2BridgeAddresses,
    challengePeriodSeconds: parseInt(process.env.BRIDGE_CHALLENGE_PERIOD_SECONDS || '604800'),
    pollInterval: parseInt(process.env.BRIDGE_POLL_INTERVAL || '5000'),
    batchSize: parseInt(process.env.BRIDGE_BATCH_SIZE || '500'),
    startL1Block: parseInt(process.env.BRIDGE_START_L1_BLOCK || '0'),
    startL2Block: parseInt(process.env.BRIDGE_START_L2_BLOCK || '0'),
  },
  api: {
    port: parseInt(process.env.API_PORT || '3001'),
    host: process.env.API_HOST || '0.0.0.0',
  },
  indexer: {
    startBlock: parseInt(process.env.START_BLOCK || '0'),
    batchSize: parseInt(process.env.BATCH_SIZE || '100'),
    pollInterval: parseInt(process.env.POLL_INTERVAL || '3000'),
  },
  redis: process.env.REDIS_URL ? {
    url: process.env.REDIS_URL,
  } : undefined,
  logLevel: process.env.LOG_LEVEL || 'info',
};

export default config;
