"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.L1ListenerService = void 0;
const ethers_1 = require("ethers");
const logger_1 = require("../utils/logger");
const models_1 = require("../database/models");
// ═══════════════════════════════════════════════════════
// L1 LISTENER SERVICE
// Purpose: Listen to L1 Diamond for deposit events
// ═══════════════════════════════════════════════════════
class L1ListenerService {
    config;
    provider = null;
    contract = null;
    isRunning = false;
    constructor(config) {
        this.config = config;
    }
    /**
     * Start listening to L1 deposits
     */
    async start() {
        (0, logger_1.logService)('L1-LISTENER', 'Starting...');
        try {
            // Connect to L1 via WebSocket
            this.provider = new ethers_1.ethers.WebSocketProvider(this.config.l1.wsUrl);
            // Create contract instance (BridgeFacet on Diamond)
            this.contract = new ethers_1.ethers.Contract(this.config.l1.diamondAddress, BRIDGE_FACET_ABI, this.provider);
            // Listen for Deposited events
            this.contract.on('Deposited', this.handleDeposit.bind(this));
            this.isRunning = true;
            (0, logger_1.logService)('L1-LISTENER', 'Started successfully', {
                diamondAddress: this.config.l1.diamondAddress,
                chainId: this.config.l1.chainId,
            });
        }
        catch (error) {
            (0, logger_1.logService)('L1-LISTENER', 'Failed to start', { error });
            throw error;
        }
    }
    /**
     * Handle deposit event from L1
     */
    async handleDeposit(depositId, token, from, to, amount, nonce, event) {
        try {
            (0, logger_1.logService)('L1-LISTENER', `Detected deposit: ${depositId.slice(0, 10)}...`, {
                token,
                from,
                to,
                nonce: nonce.toString(),
                amount: amount.toString(),
                blockNumber: event.blockNumber,
            });
            // Save to database
            await (0, models_1.saveDeposit)({
                depositId,
                tokenAddress: token,
                recipient: to,
                amount: amount.toString(),
                l1BlockNumber: event.blockNumber ? BigInt(event.blockNumber) : 0n,
                l1TxHash: event.transactionHash || '',
                processed: false,
            });
            (0, logger_1.logService)('L1-LISTENER', `Deposit saved: ${depositId.slice(0, 10)}...`);
        }
        catch (error) {
            const errorMesssage = error instanceof Error ? error.message : 'Unknown message';
            logger_1.logger.error('Failed to handle deposit event', {
                depositId,
                errorMessage: errorMesssage
            });
        }
    }
    /**
     * Stop listening
     */
    async stop() {
        (0, logger_1.logService)('L1-LISTENER', 'Stopping...');
        if (this.contract) {
            this.contract.removeAllListeners();
        }
        if (this.provider) {
            await this.provider.destroy();
        }
        this.isRunning = false;
        (0, logger_1.logService)('L1-LISTENER', 'Stopped');
    }
    /**
     * Check if service is running
     */
    isActive() {
        return this.isRunning;
    }
}
exports.L1ListenerService = L1ListenerService;
// ═══════════════════════════════════════════════════════
// BRIDGE FACET ABI (Deposited event)
// ═══════════════════════════════════════════════════════
const BRIDGE_FACET_ABI = [
    'event Deposited(bytes32 indexed depositId, address indexed token, address indexed from, address to, uint256 amount, uint256 nonce)'
];
exports.default = L1ListenerService;
//# sourceMappingURL=l1-listener.service.js.map