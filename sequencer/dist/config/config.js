"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.getConfig = getConfig;
const dotenv = __importStar(require("dotenv"));
const types_1 = require("../types");
const logger_1 = require("../utils/logger");
// Load environment variables
dotenv.config();
// ═══════════════════════════════════════════════════════
// CONFIGURATION LOADER
// ═══════════════════════════════════════════════════════
/**
 * Load and validate configuration from environment variables
 */
function loadConfig() {
    logger_1.logger.info('Loading configuration...');
    try {
        const config = {
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
        logger_1.logger.info('Configuration loaded successfully', {
            l1ChainId: config.l1.chainId,
            l2ChainId: config.l2.chainId,
            batchSize: config.batch.size,
        });
        return config;
    }
    catch (error) {
        const errorMessage = error?.message || String(error);
        logger_1.logger.error('Failed to load configuration', {
            error: errorMessage,
            stack: error?.stack,
            details: error
        });
        throw new types_1.SequencerError(`Configuration error: ${errorMessage}`, types_1.ErrorCode.CONFIG_ERROR, error);
    }
}
/**
 * Require environment variable (throw if missing)
 */
function requireEnv(key) {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
/**
 * Validate configuration
 */
function validateConfig(config) {
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
function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}
/**
 * Check if string is valid private key
 */
function isValidPrivateKey(key) {
    return /^0x[a-fA-F0-9]{64}$/.test(key) || /^[a-fA-F0-9]{64}$/.test(key);
}
// Export singleton config
let cachedConfig = null;
function getConfig() {
    if (!cachedConfig) {
        cachedConfig = loadConfig();
    }
    return cachedConfig;
}
exports.default = getConfig;
//# sourceMappingURL=config.js.map