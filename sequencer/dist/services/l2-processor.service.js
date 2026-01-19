"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.L2ProcessorService = void 0;
const ethers_1 = require("ethers");
const logger_1 = require("../utils/logger");
const models_1 = require("../database/models");
const retry_1 = require("../utils/retry");
// ═══════════════════════════════════════════════════════
// L2 PROCESSOR SERVICE
// Purpose: Process pending deposits on L2
// ═══════════════════════════════════════════════════════
class L2ProcessorService {
    config;
    provider = null;
    wallet = null;
    contract = null;
    isRunning = false;
    intervalId = null;
    constructor(config) {
        this.config = config;
    }
    /**
     * Start processing deposits
     */
    async start() {
        (0, logger_1.logService)('L2-PROCESSOR', 'Starting...');
        try {
            // Connect to L2
            this.provider = new ethers_1.ethers.JsonRpcProvider(this.config.l2.rpcUrl);
            // Create wallet
            this.wallet = new ethers_1.ethers.Wallet(this.config.sequencer.privateKey, this.provider);
            // Create L2Bridge contract instance
            this.contract = new ethers_1.ethers.Contract(this.config.l2.contracts.bridge, L2_BRIDGE_ABI, this.wallet);
            this.isRunning = true;
            // Start processing loop (every 10 seconds)
            this.intervalId = setInterval(() => {
                this.processDeposits().catch((error) => {
                    logger_1.logger.error('Error in deposit processing loop', { error });
                });
            }, 10000);
            (0, logger_1.logService)('L2-PROCESSOR', 'Started successfully', {
                bridgeAddress: this.config.l2.contracts.bridge,
                sequencer: this.config.sequencer.address,
            });
            // Process immediately on start
            await this.processDeposits();
        }
        catch (error) {
            (0, logger_1.logService)('L2-PROCESSOR', 'Failed to start', { error });
            throw error;
        }
    }
    /**
     * Process pending deposits
     */
    async processDeposits() {
        if (!this.isRunning)
            return;
        try {
            // Get pending deposits from database
            const pendingDeposits = await (0, models_1.getPendingDeposits)(this.config.maxConcurrentDeposits);
            if (pendingDeposits.length === 0) {
                return;
            }
            (0, logger_1.logService)('L2-PROCESSOR', `Processing ${pendingDeposits.length} deposits`);
            // Process each deposit
            for (const deposit of pendingDeposits) {
                await this.processDeposit(deposit);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to process deposits', { error });
        }
    }
    /**
     * Process single deposit
     */
    async processDeposit(deposit) {
        try {
            (0, logger_1.logDeposit)(deposit.depositId, 'Processing on L2', {
                recipient: deposit.recipient,
                amount: deposit.amount,
            });
            // Call L2Bridge.processDeposit()
            const tx = await (0, retry_1.retryWithDefaults)(async () => {
                return await this.contract.processDeposit(deposit.tokenAddress, deposit.recipient, deposit.amount, deposit.depositId, {
                    gasLimit: 200000,
                });
            });
            (0, logger_1.logDeposit)(deposit.depositId, 'Transaction sent', { hash: tx.hash });
            // Wait for confirmation
            const receipt = await tx.wait(1);
            if (receipt.status === 1) {
                // Mark as processed in database
                await (0, models_1.markDepositProcessed)(deposit.depositId, tx.hash);
                (0, logger_1.logDeposit)(deposit.depositId, 'Processed successfully', {
                    l2TxHash: tx.hash,
                    gasUsed: receipt.gasUsed.toString(),
                });
            }
            else {
                logger_1.logger.error('Deposit transaction failed', {
                    depositId: deposit.depositId,
                    txHash: tx.hash,
                });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to process deposit', {
                depositId: deposit.depositId,
                error,
            });
        }
    }
    /**
     * Stop processing
     */
    async stop() {
        (0, logger_1.logService)('L2-PROCESSOR', 'Stopping...');
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        (0, logger_1.logService)('L2-PROCESSOR', 'Stopped');
    }
    /**
     * Check if service is running
     */
    isActive() {
        return this.isRunning;
    }
}
exports.L2ProcessorService = L2ProcessorService;
// ═══════════════════════════════════════════════════════
// L2 BRIDGE ABI
// ═══════════════════════════════════════════════════════
const L2_BRIDGE_ABI = [
    'function processDeposit(address token, address recipient, uint256 amount, bytes32 depositId) external',
];
exports.default = L2ProcessorService;
//# sourceMappingURL=l2-processor.service.js.map