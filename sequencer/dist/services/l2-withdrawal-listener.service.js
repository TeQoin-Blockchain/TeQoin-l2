"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.L2WithdrawalListenerService = void 0;
const ethers_1 = require("ethers");
const logger_1 = require("../utils/logger");
const models_1 = require("../database/models");
// ═══════════════════════════════════════════════════════
// L2 WITHDRAWAL LISTENER SERVICE
// Purpose: Listen to L2 for withdrawal events
// ═══════════════════════════════════════════════════════
class L2WithdrawalListenerService {
    config;
    provider = null;
    contract = null;
    isRunning = false;
    constructor(config) {
        this.config = config;
    }
    /**
     * Start listening to L2 withdrawals
     */
    async start() {
        (0, logger_1.logService)('L2-WITHDRAWAL-LISTENER', 'Starting...');
        try {
            // Connect to L2 via WebSocket
            this.provider = new ethers_1.ethers.WebSocketProvider(this.config.l2.wsUrl);
            // Create L2Bridge contract instance
            this.contract = new ethers_1.ethers.Contract(this.config.l2.contracts.bridge, L2_BRIDGE_ABI, this.provider);
            // Listen for WithdrawalInitiated events
            this.contract.on('WithdrawalInitiated', this.handleWithdrawal.bind(this));
            this.isRunning = true;
            (0, logger_1.logService)('L2-WITHDRAWAL-LISTENER', 'Started successfully', {
                bridgeAddress: this.config.l2.contracts.bridge,
                chainId: this.config.l2.chainId,
            });
        }
        catch (error) {
            (0, logger_1.logService)('L2-WITHDRAWAL-LISTENER', 'Failed to start', { error });
            throw error;
        }
    }
    /**
     * Handle withdrawal event from L2
     */
    async handleWithdrawal(withdrawalId, token, from, to, amount, nonce, event) {
        try {
            (0, logger_1.logWithdrawal)(withdrawalId, 'Detected', {
                token,
                from,
                to,
                amount: amount.toString(),
                nonce: nonce.toString(),
                blockNumber: event.blockNumber,
            });
            // Save to database
            await (0, models_1.saveWithdrawal)({
                withdrawalId,
                tokenAddress: token,
                sender: from,
                recipient: to,
                amount: amount.toString(),
                l2BlockNumber: BigInt(event.blockNumber),
                l2TxHash: event.transactionHash || '',
                queued: false,
                finalized: false,
            });
            (0, logger_1.logWithdrawal)(withdrawalId, 'Saved to database');
        }
        catch (error) {
            logger_1.logger.error('Failed to handle withdrawal event', {
                withdrawalId,
                error,
            });
        }
    }
    /**
     * Stop listening
     */
    async stop() {
        (0, logger_1.logService)('L2-WITHDRAWAL-LISTENER', 'Stopping...');
        if (this.contract) {
            this.contract.removeAllListeners();
        }
        if (this.provider) {
            await this.provider.destroy();
        }
        this.isRunning = false;
        (0, logger_1.logService)('L2-WITHDRAWAL-LISTENER', 'Stopped');
    }
    /**
     * Check if service is running
     */
    isActive() {
        return this.isRunning;
    }
}
exports.L2WithdrawalListenerService = L2WithdrawalListenerService;
// ═══════════════════════════════════════════════════════
// L2 BRIDGE ABI (WithdrawalInitiated event)
// ═══════════════════════════════════════════════════════
const L2_BRIDGE_ABI = [
    'event WithdrawalInitiated(bytes32 indexed withdrawalId, address indexed token, address indexed from, address to, uint256 amount, uint256 nonce)',
];
exports.default = L2WithdrawalListenerService;
//# sourceMappingURL=l2-withdrawal-listener.service.js.map