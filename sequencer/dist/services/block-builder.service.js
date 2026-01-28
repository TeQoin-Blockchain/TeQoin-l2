"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockBuilderService = void 0;
const ethers_1 = require("ethers");
const logger_1 = require("../utils/logger");
const engine_api_client_1 = require("../engine/engine-api-client");
// ═══════════════════════════════════════════════════════
// BLOCK BUILDER SERVICE
// Builds and submits blocks via Engine API
// ═══════════════════════════════════════════════════════
class BlockBuilderService {
    config;
    l2Provider = null;
    engineAPI = null;
    isRunning = false;
    intervalId = null;
    blockInterval = 5000; // 5 seconds per block
    sequencerAddress;
    lastBlockHash = ethers_1.ethers.ZeroHash;
    lastBlockNumber = 0;
    constructor(config) {
        this.config = config;
        this.sequencerAddress = config.sequencer.address;
    }
    /**
     * Start block building
     */
    async start() {
        (0, logger_1.logService)('BLOCK-BUILDER', 'Starting...');
        try {
            // Connect to L2 RPC
            this.l2Provider = new ethers_1.ethers.JsonRpcProvider(this.config.l2.rpcUrl);
            // Initialize Engine API client
            this.engineAPI = new engine_api_client_1.EngineAPIClient(this.config.l2.engineUrl || 'http://localhost:8552', this.config.l2.jwtSecretPath || '/root/optimistic-rollup/infrastructure/docker/jwt.hex');
            // Test connectivity
            const isConnected = await this.engineAPI.ping();
            if (!isConnected) {
                throw new Error('Cannot connect to Engine API');
            }
            // Get current block state
            await this.initializeState();
            this.isRunning = true;
            // Start block production loop (every 5 seconds)
            this.intervalId = setInterval(() => {
                this.buildAndSubmitBlock().catch((error) => {
                    logger_1.logger.error('Error in block building loop', { error: error.message });
                });
            }, this.blockInterval);
            (0, logger_1.logService)('BLOCK-BUILDER', 'Started successfully', {
                blockInterval: `${this.blockInterval}ms`,
                sequencer: this.sequencerAddress,
            });
        }
        catch (error) {
            (0, logger_1.logService)('BLOCK-BUILDER', 'Failed to start', { error: error.message });
            throw error;
        }
    }
    /**
     * Initialize state from current chain
     */
    async initializeState() {
        const latestBlock = await this.l2Provider.getBlock('latest');
        if (latestBlock) {
            this.lastBlockHash = latestBlock.hash;
            this.lastBlockNumber = latestBlock.number;
            logger_1.logger.info('Initialized from chain', {
                blockNumber: this.lastBlockNumber,
                blockHash: this.lastBlockHash.slice(0, 10) + '...',
            });
        }
        else {
            // Genesis block
            this.lastBlockHash = ethers_1.ethers.ZeroHash;
            this.lastBlockNumber = 0;
            logger_1.logger.info('Starting from genesis');
        }
    }
    async buildAndSubmitBlock() {
        if (!this.isRunning)
            return;
        try {
            const blockNumber = this.lastBlockNumber + 1;
            const timestamp = Math.floor(Date.now() / 1000);
            logger_1.logger.info('Building block', { blockNumber, timestamp });
            //Geth Build Block
            const payloadAttributes = {
                timestamp: ethers_1.ethers.toBeHex(timestamp),
                prevRandao: ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(`random-${timestamp}`)),
                suggestedFeeRecipient: this.sequencerAddress,
                withdrawals: [],
            };
            const forkchoiceState = {
                headBlockHash: this.lastBlockHash,
                safeBlockHash: this.lastBlockHash,
                finalizedBlockHash: this.lastBlockHash,
            };
            logger_1.logger.debug('Requesting Geth to build block');
            const buildResult = await this.engineAPI.forkchoiceUpdatedV2(forkchoiceState, payloadAttributes);
            if (!buildResult.payloadId) {
                throw new Error('No payload ID returned');
            }
            logger_1.logger.debug('Build request accepted', { payloadId: buildResult.payloadId });
            // WAIT FOR GETH TO BUILD IT 
            await new Promise(resolve => setTimeout(resolve, 500));
            // GET THE PAYLOAD GETH BUILT
            const payloadResponse = await this.engineAPI.getPayloadV2(buildResult.payloadId);
            const payload = payloadResponse.executionPayload;
            logger_1.logger.debug('Payload retrieved', {
                blockNumber: payload.blockNumber,
                blockHash: payload.blockHash.slice(0, 10) + '...',
                transactions: payload.transactions.length,
            });
            //  SUBMIT THE PAYLOAD
            const payloadResult = await this.engineAPI.newPayloadV2(payload);
            if (payloadResult.status !== 'VALID' && payloadResult.status !== 'ACCEPTED') {
                throw new Error(`Payload rejected: ${payloadResult.status}`);
            }
            logger_1.logger.debug('Payload accepted', { status: payloadResult.status });
            // UPDATE FORKCHOICE TO FINALIZ
            const finalForkchoice = {
                headBlockHash: payload.blockHash,
                safeBlockHash: payload.blockHash,
                finalizedBlockHash: this.lastBlockHash,
            };
            const finalResult = await this.engineAPI.forkchoiceUpdatedV2(finalForkchoice);
            if (finalResult.payloadStatus.status !== 'VALID') {
                throw new Error(`Forkchoice failed: ${finalResult.payloadStatus.status}`);
            }
            // UPDATE OUR STATE
            this.lastBlockHash = payload.blockHash;
            this.lastBlockNumber = parseInt(payload.blockNumber, 16);
            logger_1.logger.info('Block built successfully', {
                blockNumber: this.lastBlockNumber,
                blockHash: payload.blockHash.slice(0, 10) + '...',
                transactions: payload.transactions.length,
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to build block', {
                error: error.message,
                blockNumber: this.lastBlockNumber + 1,
            });
        }
    }
    /**
     * Stop block building
     */
    async stop() {
        (0, logger_1.logService)('BLOCK-BUILDER', 'Stopping...');
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        (0, logger_1.logService)('BLOCK-BUILDER', 'Stopped');
    }
    /**
     * Check if service is running
     */
    isActive() {
        return this.isRunning;
    }
    /**
     * Get current block number
     */
    getCurrentBlockNumber() {
        return this.lastBlockNumber;
    }
}
exports.BlockBuilderService = BlockBuilderService;
exports.default = BlockBuilderService;
//# sourceMappingURL=block-builder.service.js.map