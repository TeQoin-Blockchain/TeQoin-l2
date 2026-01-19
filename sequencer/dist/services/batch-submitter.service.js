"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchSubmitterService = void 0;
const ethers_1 = require("ethers");
const logger_1 = require("../utils/logger");
const models_1 = require("../database/models");
const retry_1 = require("../utils/retry");
// ═══════════════════════════════════════════════════════
// BATCH SUBMITTER SERVICE
// Purpose: Submit L2 batches to L1 at rotation boundaries
// ═══════════════════════════════════════════════════════
class BatchSubmitterService {
    config;
    l1Provider = null;
    l2Provider = null;
    wallet = null;
    contract = null;
    isRunning = false;
    isSubmitting = false; // Submission lock
    intervalId = null;
    constructor(config) {
        this.config = config;
    }
    /**
     * Start batch submission
     */
    async start() {
        (0, logger_1.logService)('BATCH-SUBMITTER', 'Starting...');
        try {
            // Connect to L1
            this.l1Provider = new ethers_1.ethers.JsonRpcProvider(this.config.l1.rpcUrl);
            // Connect to L2
            this.l2Provider = new ethers_1.ethers.JsonRpcProvider(this.config.l2.rpcUrl);
            // Create wallet
            this.wallet = new ethers_1.ethers.Wallet(this.config.sequencer.privateKey, this.l1Provider);
            // Create SequencerFacet contract instance
            this.contract = new ethers_1.ethers.Contract(this.config.l1.diamondAddress, SEQUENCER_FACET_ABI, this.wallet);
            this.isRunning = true;
            // Start batch submission loop (every BATCH_INTERVAL seconds)
            this.intervalId = setInterval(() => {
                this.submitBatch().catch((error) => {
                    logger_1.logger.error('Error in batch submission loop', { error });
                });
            }, this.config.batch.interval * 1000);
            (0, logger_1.logService)('BATCH-SUBMITTER', 'Started successfully', {
                diamondAddress: this.config.l1.diamondAddress,
                batchSize: this.config.batch.size,
                batchInterval: this.config.batch.interval,
            });
        }
        catch (error) {
            (0, logger_1.logService)('BATCH-SUBMITTER', 'Failed to start', { error });
            throw error;
        }
    }
    /**
     * Submit batch to L1 at rotation boundary
     */
    async submitBatch() {
        if (!this.isRunning)
            return;
        // Prevent concurrent submissions
        if (this.isSubmitting) {
            (0, logger_1.logService)('BATCH-SUBMITTER', 'Submission already in progress, skipping...');
            return;
        }
        this.isSubmitting = true;
        try {
            // Get current L2 block
            const currentBlock = await this.l2Provider.getBlockNumber();
            // Get last submitted block from L1 contract
            const lastSubmitted = await this.contract.getLatestL2Block();
            // Calculate next rotation boundary (must be divisible by 100)
            const nextRotationBlock = lastSubmitted + BigInt(this.config.batch.size);
            // Check if L2 has reached the next rotation boundary
            if (BigInt(currentBlock) < nextRotationBlock) {
                const blocksRemaining = nextRotationBlock - BigInt(currentBlock);
                (0, logger_1.logService)('BATCH-SUBMITTER', 'Waiting for next rotation boundary', {
                    currentBlock,
                    nextRotation: nextRotationBlock.toString(),
                    blocksRemaining: blocksRemaining.toString(),
                });
                return;
            }
            (0, logger_1.logBatch)(nextRotationBlock, `Preparing batch for block ${nextRotationBlock}`);
            // Collect block data from L2
            const { stateRoot, transactionsRoot } = await this.collectBlockData(lastSubmitted + 1n, nextRotationBlock);
            // Submit to L1 (3 parameters only!)
            const tx = await (0, retry_1.retryWithDefaults)(async () => {
                return await this.contract.submitBatch(nextRotationBlock, // l2BlockNumber (at rotation boundary: 100, 200, 300...)
                stateRoot, transactionsRoot);
            });
            (0, logger_1.logBatch)(nextRotationBlock, 'Transaction sent', { hash: tx.hash });
            // Wait for confirmation
            const receipt = await tx.wait(1);
            if (receipt && receipt.status === 1) {
                // Calculate batch number
                const batchNumber = nextRotationBlock / BigInt(this.config.batch.size);
                // Save to database (convert BigInt to string for JSON serialization)
                await (0, models_1.saveBatch)({
                    batchNumber,
                    l2StartBlock: lastSubmitted + 1n,
                    l2EndBlock: nextRotationBlock,
                    stateRoot,
                    transactionsRoot,
                    submitted: false,
                });
                await (0, models_1.markBatchSubmitted)(batchNumber, tx.hash);
                (0, logger_1.logBatch)(batchNumber, 'Submitted successfully', {
                    l1TxHash: tx.hash,
                    gasUsed: receipt.gasUsed.toString(),
                    l2Block: nextRotationBlock.toString(),
                });
            }
            else {
                logger_1.logger.error('Batch transaction failed', {
                    txHash: tx.hash,
                    l2Block: nextRotationBlock.toString(),
                });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to submit batch', {
                error: error.message || String(error),
                code: error.code,
            });
        }
        finally {
            // Always release the lock
            this.isSubmitting = false;
        }
    }
    /**
     * Collect block data from L2
     */
    async collectBlockData(startBlock, endBlock) {
        try {
            // Get the block at rotation boundary
            const block = await this.l2Provider.getBlock(Number(endBlock));
            if (!block) {
                throw new Error(`Block ${endBlock} not found on L2`);
            }
            // For MVP: Use block's stateRoot and hash
            const stateRoot = block.stateRoot || ethers_1.ethers.ZeroHash;
            const transactionsRoot = block.hash || ethers_1.ethers.ZeroHash;
            return { stateRoot, transactionsRoot };
        }
        catch (error) {
            logger_1.logger.error('Failed to collect block data', {
                startBlock: startBlock.toString(),
                endBlock: endBlock.toString(),
                error,
            });
            throw error;
        }
    }
    /**
     * Stop batch submission
     */
    async stop() {
        (0, logger_1.logService)('BATCH-SUBMITTER', 'Stopping...');
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        (0, logger_1.logService)('BATCH-SUBMITTER', 'Stopped');
    }
    /**
     * Check if service is running
     */
    isActive() {
        return this.isRunning;
    }
}
exports.BatchSubmitterService = BatchSubmitterService;
// ═══════════════════════════════════════════════════════
// SEQUENCER FACET ABI
// ═══════════════════════════════════════════════════════
const SEQUENCER_FACET_ABI = [
    'function submitBatch(uint256 l2BlockNumber, bytes32 stateRoot, bytes32 transactionsRoot) external',
    'function getLatestL2Block() external view returns (uint256)',
    'function getCurrentSequencer(uint256 l2BlockNumber) external view returns (address)',
    'function isRegisteredSequencer(address sequencer) external view returns (bool)',
];
exports.default = BatchSubmitterService;
//# sourceMappingURL=batch-submitter.service.js.map