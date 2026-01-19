import * as dotenv from 'dotenv';
import { Config, SequencerError, ErrorCode } from '../types';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

// ═══════════════════════════════════════════════════════
// CONFIGURATION LOADER
// ═══════════════════════════════════════════════════════

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
  logger.info('Loading configuration...');
  
  try {
    const config: Config = {
      l1: {
        rpcUrl: requireEnv('L1_RPC_URL'),
        wsUrl: requireEnv('L1_WS_URL'),
        chainId: parseInt(requireEnv('L1_CHAIN_ID')),
        diamondAddress: requireEnv('L1_DIAMOND_ADDRESS'),
      },
      
      l2: {
        rpcUrl: requireEnv('L2_RPC_URL'),
        wsUrl: requireEnv('L2_WS_URL'),
        chainId: parseInt(requireEnv('L2_CHAIN_ID')),
        contracts: {
          teqToken: requireEnv('L2_TEQTOKEN_ADDRESS'),
          bridge: requireEnv('L2_BRIDGE_ADDRESS'),
          staking: requireEnv('L2_STAKING_ADDRESS'),
        },
        engineUrl: requireEnv('L2_ENGINE_URL') || 'http://localhost:8552',
        jwtSecretPath: process.env.L2_JWT_SECRET_PATH || '/root/optimistic-rollup/infrastructure/docker/jwt.hex',
      },
      
      sequencer: {
        address: requireEnv('SEQUENCER_ADDRESS'),
        privateKey: requireEnv('SEQUENCER_PRIVATE_KEY'),
      },
      
      batch: {
        size: parseInt(process.env.BATCH_SIZE || '100'),
        interval: parseInt(process.env.BATCH_INTERVAL || '500'),
        gasLimit: parseInt(process.env.BATCH_GAS_LIMIT || '3000000'),
      },
      
      database: {
        url: requireEnv('DATABASE_URL'),
      },
      
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || './logs/sequencer.log',
      },
      
      healthCheck: {
        port: parseInt(process.env.HEALTH_CHECK_PORT || '3000'),
      },
      
      retry: {
        attempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
        delay: parseInt(process.env.RETRY_DELAY || '5000'),
      },
      
      maxConcurrentDeposits: parseInt(process.env.MAX_CONCURRENT_DEPOSITS || '5'),
    };
    
    // Validate configuration
    validateConfig(config);
    
    logger.info('Configuration loaded successfully', {
      l1ChainId: config.l1.chainId,
      l2ChainId: config.l2.chainId,
      batchSize: config.batch.size,
    });
    
    return config;
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    logger.error('Failed to load configuration', { 
      error: errorMessage,
      stack: error?.stack,
      details: error
    });
    throw new SequencerError(
      `Configuration error: ${errorMessage}`,
      ErrorCode.CONFIG_ERROR,
      error
    );
  }
}

/**
 * Require environment variable (throw if missing)
 */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Validate configuration
 */
function validateConfig(config: Config): void {
  // Validate addresses (Ethereum format)
  const addresses = [
    config.l1.diamondAddress,
    config.l2.contracts.teqToken,
    config.l2.contracts.bridge,
    config.l2.contracts.staking,
    config.sequencer.address,
  ];
  
  for (const address of addresses) {
    if (!isValidAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }
  }
  
  // Validate private key
  if (!isValidPrivateKey(config.sequencer.privateKey)) {
    throw new Error('Invalid private key format');
  }
  
  // Validate chain IDs
  if (config.l1.chainId === config.l2.chainId) {
    throw new Error('L1 and L2 chain IDs must be different');
  }
  
  // Validate batch size
  if (config.batch.size < 1 || config.batch.size > 1000) {
    throw new Error('Batch size must be between 1 and 1000');
  }
  
  // Validate URLs
  if (!config.l1.rpcUrl.startsWith('http')) {
    throw new Error('L1 RPC URL must start with http or https');
  }
  
  if (!config.l2.rpcUrl.startsWith('http')) {
    throw new Error('L2 RPC URL must start with http or https');
  }
}

/**
 * Check if string is valid Ethereum address
 */
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Check if string is valid private key
 */
function isValidPrivateKey(key: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(key) || /^[a-fA-F0-9]{64}$/.test(key);
}

// Export singleton config
let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export default getConfig;