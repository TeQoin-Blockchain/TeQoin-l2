"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sequencer = void 0;
const ethers_1 = require("ethers");
const logger_1 = require("../utils/logger");
const merkle_1 = require("../utils/merkle");
const abis_1 = require("../config/abis");
class Sequencer {
    l1Provider;
    l2Provider;
    sequencerWallet;
    l1Bridge;
    l1StateCommitment;
    l2Bridge;
    db;
    redis;
    config;
    currentBlockNumber = 0n;
    blockInterval = null;
    batchInterval = null;
    isRunning = false;
    constructor(config, db, redis) {
        this.config = config;
        this.db = db;
        this.redis = redis;
        // Initialize providers
        this.l1Provider = new ethers_1.ethers.JsonRpcProvider(config.l1RpcUrl);
        this.l2Provider = new ethers_1.ethers.JsonRpcProvider(config.l2RpcUrl);
        // Initialize wallet
        this.sequencerWallet = new ethers_1.ethers.Wallet(config.sequencerPrivateKey, this.l1Provider);
        // Initialize contracts
        this.l1Bridge = new ethers_1.ethers.Contract(config.l1BridgeAddress, abis_1.L1_BRIDGE_ABI, this.sequencerWallet);
        this.l1StateCommitment = new ethers_1.ethers.Contract(config.l1StateCommitmentAddress, abis_1.L1_STATE_COMMITMENT_ABI, this.sequencerWallet);
        this.l2Bridge = new ethers_1.ethers.Contract(config.l2BridgeAddress, abis_1.L2_BRIDGE_ABI, new ethers_1.ethers.Wallet(config.sequencerPrivateKey, this.l2Provider));
        logger_1.logger.info('Sequencer initialized');
    }
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('Sequencer is already running');
            return;
        }
        logger_1.logger.info('🚀 Starting Sequencer...\n');
        // Get last block number
        const lastBlock = await this.db.getLastBlock();
        this.currentBlockNumber = lastBlock ? lastBlock.number + 1n : 1n;
        logger_1.logger.info(`📊 Starting from L2 block #${this.currentBlockNumber}`);
        // Start services
        this.startDepositListener();
        this.startBlockProduction();
        this.startBatchSubmission();
        this.startWithdrawalListener;
        this.isRunning = true;
        logger_1.logger.info('✅ Sequencer started successfully!\n');
    }
    startDepositListener() {
        logger_1.logger.info('👂 Listening for L1 deposits...');
        this.l1Bridge.on('Deposited', async (token, from, to, amount, nonce, event) => {
            try {
                logger_1.logger.info(`\n💰 NEW DEPOSIT DETECTED!`);
                logger_1.logger.info(`   From: ${from}`);
                logger_1.logger.info(`   To: ${to}`);
                logger_1.logger.info(`   Amount: ${ethers_1.ethers.formatEther(amount)} ETH`);
                logger_1.logger.info(`   Nonce: ${nonce.toString()}`);
                logger_1.logger.info(`   L1 Block: ${event.log.blockNumber}`);
                // Create deposit transaction hash
                const depositTxHash = ethers_1.ethers.keccak256(ethers_1.ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint256', 'uint256'], [from, to, amount, nonce]));
                // Add to pending transactions
                await this.redis.pushTransaction(depositTxHash);
                logger_1.logger.info(`   ✅ Added to pending transactions\n`);
                logger_1.logger.info(`Processing deposit on l2`);
                try {
                    if (token === ethers_1.ethers.ZeroAddress) {
                        // For ETH deposits: Send NATIVE ETH to user
                        logger_1.logger.info(`   📤 Sending native ETH to user...`);
                        const tx = await this.l2Bridge.finalizeETHDeposit(to, amount, nonce, {
                            value: amount, // ⭐ Send native ETH!
                            gasLimit: 500000
                        });
                        logger_1.logger.info(`   ⏳ Waiting for L2 transaction...`);
                        const receipt = await tx.wait();
                        if (receipt.status === 1) {
                            logger_1.logger.info(`   ✅ NATIVE ETH SENT!`);
                            logger_1.logger.info(`   📝 L2 Tx: ${tx.hash}`);
                            logger_1.logger.info(`   💰 ${to} now has +${ethers_1.ethers.formatEther(amount)} native ETH on L2!`);
                            logger_1.logger.info(`   🎉 Check MetaMask - it should show now!\n`);
                        }
                        else {
                            logger_1.logger.error(`   ❌ L2 transaction failed!`);
                        }
                    }
                    else {
                        // For ERC20 deposits
                        const tx = await this.l2Bridge.finalizeERC20Deposit(token, to, amount, nonce);
                        await tx.wait();
                        logger_1.logger.info(`   ✅ ERC20 tokens minted!\n`);
                    }
                }
                catch (error) {
                    logger_1.logger.error(`   ❌ Failed to credit balance: ${error.reason || error.message}`);
                }
            }
            catch (error) {
                logger_1.logger.error('Failed to process deposit:', error);
            }
        });
    }
    startWithdrawalListener() {
        logger_1.logger.info('👂 Listening for L2 withdrawals...');
        this.l2Bridge.on('WithdrawalInitiated', async (l2Token, from, to, amount, nonce, event) => {
            try {
                logger_1.logger.info(`\n💸 NEW WITHDRAWAL DETECTED!`);
                logger_1.logger.info(`   From (L2): ${from}`);
                logger_1.logger.info(`   To (L1): ${to}`);
                logger_1.logger.info(`   Amount: ${ethers_1.ethers.formatEther(amount)} ETH`);
                logger_1.logger.info(`   📤 Initiating withdrawal on L1...`);
                const tx = await this.l1Bridge.initiateWithdrawal(from, to, amount, BigInt(event.log.blockNumber), { gasLimit: 500000 });
                const receipt = await tx.wait();
                if (receipt && receipt.status === 1) {
                    // Fix: Explicitly type 'log' and 'e' as any to bypass strict checks
                    const withdrawalEvent = receipt.logs
                        .map((log) => {
                        try {
                            return this.l1Bridge.interface.parseLog({
                                topics: [...log.topics],
                                data: log.data,
                            });
                        }
                        catch {
                            return null;
                        }
                    })
                        .find((e) => e?.name === 'WithdrawalInitiated');
                    if (withdrawalEvent) {
                        const withdrawalId = withdrawalEvent.args.withdrawalId;
                        // Fix: Map variables correctly and include missing required fields
                        await this.db.saveWithdrawal({
                            withdrawalId: withdrawalId.toString(),
                            l2Token: l2Token,
                            fromAddress: from, // Map 'from' variable to 'fromAddress' key
                            toAddress: to, // Map 'to' variable to 'toAddress' key
                            amount: amount.toString(),
                            l2WithdrawalNonce: nonce.toString(),
                            l2BlockNumber: BigInt(event.log.blockNumber),
                            l1TransactionHash: tx.hash,
                            l1FinalizeHash: null, // Required by type
                            status: 'pending',
                            initiatedAt: new Date(),
                            finalizedAt: null // Required by type
                        });
                        logger_1.logger.info(`   🆔 Withdrawal ID: ${withdrawalId.toString()}`);
                        logger_1.logger.info(`   💾 Withdrawal saved to database\n`);
                    }
                }
            }
            catch (error) {
                logger_1.logger.error(`   ❌ Failed to process withdrawal: ${error.message}`);
            }
        });
    }
    startBlockProduction() {
        logger_1.logger.info(`⏱️  Block production: Every ${this.config.blockTimeMs}ms`);
        this.blockInterval = setInterval(async () => {
            await this.produceBlock();
        }, this.config.blockTimeMs);
    }
    async produceBlock() {
        try {
            // Get L2 block info
            const l2Block = await this.l2Provider.getBlock('latest');
            if (!l2Block) {
                logger_1.logger.warn('No L2 block available');
                return;
            }
            // Get pending transactions
            const txCount = await this.redis.getTransactionCount();
            const txHashes = [];
            for (let i = 0; i < Math.min(txCount, this.config.batchSize); i++) {
                const txHash = await this.redis.popTransaction();
                if (txHash)
                    txHashes.push(txHash);
            }
            // Build state tree
            const states = await this.getL2State();
            const stateTree = new merkle_1.MerkleTree(states);
            const stateRoot = stateTree.getRoot();
            // Build transaction tree
            const txRoot = (0, merkle_1.buildTransactionRoot)(txHashes);
            // Create block
            const block = {
                number: this.currentBlockNumber,
                hash: l2Block.hash,
                parentHash: l2Block.parentHash,
                stateRoot,
                timestamp: BigInt(l2Block.timestamp),
                transactionCount: txHashes.length,
                gasUsed: l2Block.gasUsed,
            };
            // Save to database
            await this.db.saveBlock(block);
            logger_1.logger.info(`🔨 Block #${this.currentBlockNumber} mined`);
            logger_1.logger.info(`   Transactions: ${txHashes.length}`);
            logger_1.logger.info(`   State Root: ${stateRoot.slice(0, 10)}...`);
            logger_1.logger.info(`   Tx Root: ${txRoot.slice(0, 10)}...`);
            this.currentBlockNumber++;
        }
        catch (error) {
            logger_1.logger.error('Failed to produce block:', error);
        }
    }
    startBatchSubmission() {
        logger_1.logger.info(`📦 Batch submission: Every ${this.config.batchIntervalMs}ms\n`);
        this.batchInterval = setInterval(async () => {
            await this.submitBatch();
        }, this.config.batchIntervalMs);
    }
    async submitBatch() {
        try {
            // Early exit if no blocks
            if (this.currentBlockNumber <= 1n) {
                logger_1.logger.debug('No blocks to batch yet');
                return;
            }
            // ===================================================================
            // PRE-FLIGHT CHECKS - RUN THESE FIRST!
            // ===================================================================
            logger_1.logger.info(`\n🔍 PRE-FLIGHT CHECKS:`);
            // Check 1: Wallet connection
            try {
                const address = await this.sequencerWallet.getAddress();
                logger_1.logger.info(`   ✅ Wallet address: ${address}`);
            }
            catch (error) {
                logger_1.logger.error(`   ❌ Wallet error: ${error.message}`);
                return;
            }
            // Check 2: L1 connection
            let l1BlockNumber;
            try {
                l1BlockNumber = await this.l1Provider.getBlockNumber();
                logger_1.logger.info(`   ✅ L1 block number: ${l1BlockNumber}`);
            }
            catch (error) {
                logger_1.logger.error(`   ❌ L1 provider error: ${error.message}`);
                return;
            }
            // Check 3: Wallet balance
            let balance;
            try {
                balance = await this.l1Provider.getBalance(this.sequencerWallet.address);
                logger_1.logger.info(`   💰 Sequencer balance: ${ethers_1.ethers.formatEther(balance)} ETH`);
                if (balance < ethers_1.ethers.parseEther('0.01')) {
                    logger_1.logger.error(`   ❌ Insufficient balance! Need at least 0.01 ETH`);
                    logger_1.logger.error(`   💡 Fund this address: ${this.sequencerWallet.address}`);
                    return;
                }
            }
            catch (error) {
                logger_1.logger.error(`   ❌ Balance check error: ${error.message}`);
                return;
            }
            // Check 4: Gas price
            try {
                const feeData = await this.l1Provider.getFeeData();
                const gasPrice = feeData.gasPrice || 0n;
                logger_1.logger.info(`   ⛽ Gas price: ${ethers_1.ethers.formatUnits(gasPrice, 'gwei')} gwei`);
                if (gasPrice > ethers_1.ethers.parseUnits('100', 'gwei')) {
                    logger_1.logger.warn(`   ⚠️  High gas price! Consider waiting.`);
                }
            }
            catch (error) {
                logger_1.logger.warn(`   ⚠️  Gas price check failed: ${error.message}`);
                // Don't return - this is non-critical
            }
            // Check 5: Contract connection
            let currentBatchId;
            try {
                currentBatchId = await this.l1StateCommitment.currentBatchId();
                logger_1.logger.info(`   📦 Current batch ID: ${currentBatchId}`);
            }
            catch (error) {
                logger_1.logger.error(`   ❌ State commitment contract error: ${error.message}`);
                logger_1.logger.error(`   💡 Check contract address: ${this.config.l1StateCommitmentAddress}`);
                return;
            }
            // ===================================================================
            // PREPARE BATCH DATA
            // ===================================================================
            logger_1.logger.info(`\n📦 PREPARING BATCH...`);
            const lastBlock = await this.db.getLastBlock();
            if (!lastBlock) {
                logger_1.logger.warn('   ❌ No last block found in database');
                return;
            }
            logger_1.logger.info(`   L2 Block: #${lastBlock.number}`);
            logger_1.logger.info(`   State Root: ${lastBlock.stateRoot.slice(0, 10)}...`);
            // Build transaction root
            logger_1.logger.info(`   Building transaction root...`);
            const txRoot = (0, merkle_1.buildTransactionRoot)([lastBlock.hash]);
            logger_1.logger.info(`   Tx Root: ${txRoot.slice(0, 10)}...`);
            // ===================================================================
            // SUBMIT TO L1
            // ===================================================================
            logger_1.logger.info(`\n📤 SUBMITTING TO L1...`);
            // Estimate gas first
            let estimatedGas;
            try {
                estimatedGas = await this.l1StateCommitment.submitBatch.estimateGas(lastBlock.stateRoot, txRoot, lastBlock.number, '0x');
                logger_1.logger.info(`   ⛽ Estimated gas: ${estimatedGas.toString()}`);
            }
            catch (error) {
                logger_1.logger.error(`   ❌ Gas estimation failed: ${error.message}`);
                logger_1.logger.error(`   💡 This usually means the transaction will revert`);
                return;
            }
            // Submit transaction
            const tx = await this.l1StateCommitment.submitBatch(lastBlock.stateRoot, txRoot, lastBlock.number, '0x', {
                gasLimit: estimatedGas * 120n / 100n, // 20% buffer
            });
            logger_1.logger.info(`   ✅ Transaction sent!`);
            logger_1.logger.info(`   📝 Tx Hash: ${tx.hash}`);
            logger_1.logger.info(`   🔗 Etherscan: https://sepolia.etherscan.io/tx/${tx.hash}`);
            logger_1.logger.info(`   ⏳ Waiting for confirmation...`);
            // Wait for confirmation
            const receipt = await tx.wait();
            if (receipt.status === 1) {
                logger_1.logger.info(`\n   ✅ BATCH SUBMITTED SUCCESSFULLY!`);
                logger_1.logger.info(`   ⛽ Gas used: ${receipt.gasUsed.toString()}`);
                logger_1.logger.info(`   📦 L1 Block: ${receipt.blockNumber}`);
                logger_1.logger.info(`   💰 Cost: ${ethers_1.ethers.formatEther(receipt.gasUsed * (receipt.gasPrice || 0n))} ETH\n`);
            }
            else {
                logger_1.logger.error(`   ❌ Transaction reverted!`);
                return;
            }
            // Save batch to database
            await this.db.saveBatch({
                stateRoot: lastBlock.stateRoot,
                transactionRoot: txRoot,
                l2BlockNumber: lastBlock.number,
                l1TransactionHash: tx.hash,
                status: 'submitted',
                submittedAt: new Date(),
            });
            logger_1.logger.info(`   💾 Batch saved to database\n`);
        }
        catch (error) {
            logger_1.logger.error(`\n❌ BATCH SUBMISSION FAILED!`);
            logger_1.logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            // Error type
            logger_1.logger.error(`Type: ${typeof error}`);
            // Error message
            if (error.message) {
                logger_1.logger.error(`Message: ${error.message}`);
            }
            // Error code
            if (error.code) {
                logger_1.logger.error(`Code: ${error.code}`);
            }
            // Revert reason
            if (error.reason) {
                logger_1.logger.error(`Reason: ${error.reason}`);
            }
            // Transaction data
            if (error.transaction) {
                logger_1.logger.error(`Transaction data:`);
                logger_1.logger.error(`  From: ${error.transaction.from}`);
                logger_1.logger.error(`  To: ${error.transaction.to}`);
                logger_1.logger.error(`  Data: ${error.transaction.data?.slice(0, 66)}...`);
            }
            // Receipt (if available)
            if (error.receipt) {
                logger_1.logger.error(`Receipt:`);
                logger_1.logger.error(`  Status: ${error.receipt.status}`);
                logger_1.logger.error(`  Gas used: ${error.receipt.gasUsed?.toString()}`);
            }
            // Inner error
            if (error.error) {
                logger_1.logger.error(`Inner error: ${JSON.stringify(error.error, null, 2)}`);
            }
            // Stack trace
            if (error.stack) {
                logger_1.logger.error(`Stack trace:`);
                logger_1.logger.error(error.stack);
            }
            logger_1.logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        }
    }
    async getL2State() {
        // Get balances of known addresses
        const addresses = [
            '0x050bf90cc79d7a4aca382b233002303fb7baa5a3',
            '0x90c7ced44627148a266bd875654299cfc474e347',
            '0x905179aa177fd8727ce67479fb562f2472704b31',
        ];
        const states = [];
        for (const address of addresses) {
            try {
                const balance = await this.l2Provider.getBalance(address);
                const nonce = await this.l2Provider.getTransactionCount(address);
                states.push({
                    address,
                    balance,
                    nonce: BigInt(nonce),
                });
            }
            catch (error) {
                logger_1.logger.debug(`Failed to get state for ${address}`);
            }
        }
        return states;
    }
    async stop() {
        logger_1.logger.info('\n🛑 Stopping sequencer...');
        if (this.blockInterval)
            clearInterval(this.blockInterval);
        if (this.batchInterval)
            clearInterval(this.batchInterval);
        this.l1Bridge.removeAllListeners();
        this.isRunning = false;
        logger_1.logger.info('✅ Sequencer stopped');
    }
}
exports.Sequencer = Sequencer;
//# sourceMappingURL=sequencer.js.map