import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { DatabaseService, Block } from './database';
import { RedisService } from './redis';
import { MerkleTree, buildTransactionRoot, StateEntry } from '../utils/merkle';
import { 
  L1_BRIDGE_ABI, 
  L1_STATE_COMMITMENT_ABI, 
  L2_BRIDGE_ABI 
} from '../config/abis';
import { log } from 'console';

export interface SequencerConfig {
  l1RpcUrl: string;
  l2RpcUrl: string;
  sequencerPrivateKey: string;
  l1BridgeAddress: string;
  l1StateCommitmentAddress: string;
  l2BridgeAddress: string;
  blockTimeMs: number;
  batchIntervalMs: number;
  batchSize: number;
}

export class Sequencer {
  private l1Provider: ethers.JsonRpcProvider;
  private l2Provider: ethers.JsonRpcProvider;
  private sequencerWallet: ethers.Wallet;
  
  private l1Bridge: ethers.Contract;
  private l1StateCommitment: ethers.Contract;
  private l2Bridge: ethers.Contract;
  
  private db: DatabaseService;
  private redis: RedisService;
  
  private config: SequencerConfig;
  private currentBlockNumber: bigint = 0n;
  
  private blockInterval: NodeJS.Timeout | null = null;
  private batchInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(
    config: SequencerConfig,
    db: DatabaseService,
    redis: RedisService
  ) {
    this.config = config;
    this.db = db;
    this.redis = redis;

    // Initialize providers
    this.l1Provider = new ethers.JsonRpcProvider(config.l1RpcUrl);
    this.l2Provider = new ethers.JsonRpcProvider(config.l2RpcUrl);

    // Initialize wallet
    this.sequencerWallet = new ethers.Wallet(
      config.sequencerPrivateKey,
      this.l1Provider
    );

    // Initialize contracts
    this.l1Bridge = new ethers.Contract(
      config.l1BridgeAddress,
      L1_BRIDGE_ABI,
      this.sequencerWallet
    );

    this.l1StateCommitment = new ethers.Contract(
      config.l1StateCommitmentAddress,
      L1_STATE_COMMITMENT_ABI,
      this.sequencerWallet
    );

    this.l2Bridge = new ethers.Contract(
      config.l2BridgeAddress,
      L2_BRIDGE_ABI,
      new ethers.Wallet(config.sequencerPrivateKey, this.l2Provider)
    );

    logger.info('Sequencer initialized');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Sequencer is already running');
      return;
    }

    logger.info('🚀 Starting Sequencer...\n');

    // Get last block number
    const lastBlock = await this.db.getLastBlock();
    this.currentBlockNumber = lastBlock ? lastBlock.number + 1n : 1n;

    logger.info(`📊 Starting from L2 block #${this.currentBlockNumber}`);

    // Start services
    this.startDepositListener();
    this.startBlockProduction();
    this.startBatchSubmission();
    this.startWithdrawalListener();

    this.isRunning = true;
    logger.info('✅ Sequencer started successfully!\n');
  }

  private startDepositListener(): void {
    logger.info('👂 Listening for L1 deposits...');

    this.l1Bridge.on('Deposited', async (token, from, to, amount, nonce, event) => {
      try {
        logger.info(`\n💰 NEW DEPOSIT DETECTED!`);
        logger.info(`   From: ${from}`);
        logger.info(`   To: ${to}`);
        logger.info(`   Amount: ${ethers.formatEther(amount)} ETH`);
        logger.info(`   Nonce: ${nonce.toString()}`);
        logger.info(`   L1 Block: ${event.log.blockNumber}`);

        // Create deposit transaction hash
        const depositTxHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'uint256', 'uint256'],
            [from, to, amount, nonce]
          )
        );

        // Add to pending transactions
        await this.redis.pushTransaction(depositTxHash);


        logger.info(`   ✅ Added to pending transactions\n`);
        logger.info(`Processing deposit on l2`)
        try {
          if (token === ethers.ZeroAddress) {
            // For ETH deposits: Send NATIVE ETH to user
            logger.info(`   📤 Sending native ETH to user...`);
          
            const tx = await this.l2Bridge.finalizeETHDeposit(
              to,
              amount,
              nonce,
              {
                value: amount, // ⭐ Send native ETH!
                gasLimit: 500000
              }
            );

            logger.info(`   ⏳ Waiting for L2 transaction...`);
            const receipt = await tx.wait();

            if (receipt.status === 1) {
              logger.info(`   ✅ NATIVE ETH SENT!`);
              logger.info(`   📝 L2 Tx: ${tx.hash}`);
              logger.info(`   💰 ${to} now has +${ethers.formatEther(amount)} native ETH on L2!`);
              logger.info(`   🎉 Check MetaMask - it should show now!\n`);
            } else {
              logger.error(`   ❌ L2 transaction failed!`);
            }
          } else {
            // For ERC20 deposits
            const tx = await this.l2Bridge.finalizeERC20Deposit(
              token,
              to,
              amount,
              nonce
            );
            await tx.wait();
            logger.info(`   ✅ ERC20 tokens minted!\n`);
          }
        } catch (error: any) {
          logger.error(`   ❌ Failed to credit balance: ${error.reason || error.message}`);
        }

      } catch (error) {
        logger.error('Failed to process deposit:', error);
      }
    });
  } 
  private startWithdrawalListener(): void {
    logger.info('👂 Listening for L2 withdrawals...');

    this.l2Bridge.on('WithdrawalInitiated', async (l2Token, from, to, amount, nonce, event) => {
      try {
        logger.info(`\n💸 NEW WITHDRAWAL DETECTED!`);
        logger.info(`   From (L2): ${from}`);
        logger.info(`   To (L1): ${to}`);
        logger.info(`   Amount: ${ethers.formatEther(amount)} ETH`);

        logger.info(`   📤 Initiating withdrawal on L1...`);

        const tx = await this.l1Bridge.initiateWithdrawal(
          from,
          to,
          amount,
          BigInt(event.log.blockNumber),
          { gasLimit: 500000 }
        );

        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
          // Fix: Explicitly type 'log' and 'e' as any to bypass strict checks
          const withdrawalEvent = receipt.logs
            .map((log: any) => {
              try {
                return this.l1Bridge.interface.parseLog({
                  topics: [...log.topics],
                  data: log.data,
                });
              } catch { return null; }
            })
            .find((e: any) => e?.name === 'WithdrawalInitiated');

          if (withdrawalEvent) {
            const withdrawalId = withdrawalEvent.args.withdrawalId;
            
            // Fix: Map variables correctly and include missing required fields
            await this.db.saveWithdrawal({
              withdrawalId: withdrawalId.toString(),
              l2Token: l2Token,
              fromAddress: from, // Map 'from' variable to 'fromAddress' key
              toAddress: to,     // Map 'to' variable to 'toAddress' key
              amount: amount.toString(),
              l2WithdrawalNonce: nonce.toString(),
              l2BlockNumber: BigInt(event.log.blockNumber),
              l1TransactionHash: tx.hash,
              l1FinalizeHash: null, // Required by type
              status: 'pending',
              initiatedAt: new Date(),
              finalizedAt: null     // Required by type
            });

            logger.info(`   🆔 Withdrawal ID: ${withdrawalId.toString()}`);
            logger.info(`   💾 Withdrawal saved to database\n`);
          }
        }
      } catch (error: any) {
        logger.error(`   ❌ Failed to process withdrawal: ${error.message}`);
      }
    });
  }
  
  private startBlockProduction(): void {
    logger.info(`⏱️  Block production: Every ${this.config.blockTimeMs}ms`);

    this.blockInterval = setInterval(async () => {
      await this.produceBlock();
    }, this.config.blockTimeMs);
  }

  private async produceBlock(): Promise<void> {
    try {
      // Get L2 block info
      const l2Block = await this.l2Provider.getBlock('latest');
      if (!l2Block) {
        logger.warn('No L2 block available');
        return;
      }

      // Get pending transactions
      const txCount = await this.redis.getTransactionCount();
      const txHashes: string[] = [];

      for (let i = 0; i < Math.min(txCount, this.config.batchSize); i++) {
        const txHash = await this.redis.popTransaction();
        if (txHash) txHashes.push(txHash);
      }

      // Build state tree
      const states = await this.getL2State();
      const stateTree = new MerkleTree(states);
      const stateRoot = stateTree.getRoot();

      // Build transaction tree
      const txRoot = buildTransactionRoot(txHashes);

      // Create block
      const block: Block = {
        number: this.currentBlockNumber,
        hash: l2Block.hash!,
        parentHash: l2Block.parentHash,
        stateRoot,
        timestamp: BigInt(l2Block.timestamp),
        transactionCount: txHashes.length,
        gasUsed: l2Block.gasUsed,
      };

      // Save to database
      await this.db.saveBlock(block);

      logger.info(`🔨 Block #${this.currentBlockNumber} mined`);
      logger.info(`   Transactions: ${txHashes.length}`);
      logger.info(`   State Root: ${stateRoot.slice(0, 10)}...`);
      logger.info(`   Tx Root: ${txRoot.slice(0, 10)}...`);

      this.currentBlockNumber++;
    } catch (error) {
      logger.error('Failed to produce block:', error);
    }
  }

  private startBatchSubmission(): void {
    logger.info(`📦 Batch submission: Every ${this.config.batchIntervalMs}ms\n`);

    this.batchInterval = setInterval(async () => {
      await this.submitBatch();
    }, this.config.batchIntervalMs);
  }

  private async submitBatch(): Promise<void> {
    try {
      // Early exit if no blocks
      if (this.currentBlockNumber <= 1n) {
        logger.debug('No blocks to batch yet');
        return;
      }

      // ===================================================================
      // PRE-FLIGHT CHECKS - RUN THESE FIRST!
      // ===================================================================
      logger.info(`\n🔍 PRE-FLIGHT CHECKS:`);
      
      // Check 1: Wallet connection
      try {
        const address = await this.sequencerWallet.getAddress();
        logger.info(`   ✅ Wallet address: ${address}`);
      } catch (error: any) {
        logger.error(`   ❌ Wallet error: ${error.message}`);
        return;
      }

      // Check 2: L1 connection
      let l1BlockNumber: number;
      try {
        l1BlockNumber = await this.l1Provider.getBlockNumber();
        logger.info(`   ✅ L1 block number: ${l1BlockNumber}`);
      } catch (error: any) {
        logger.error(`   ❌ L1 provider error: ${error.message}`);
        return;
      }

      // Check 3: Wallet balance
      let balance: bigint;
      try {
        balance = await this.l1Provider.getBalance(this.sequencerWallet.address);
        logger.info(`   💰 Sequencer balance: ${ethers.formatEther(balance)} ETH`);
        
        if (balance < ethers.parseEther('0.01')) {
          logger.error(`   ❌ Insufficient balance! Need at least 0.01 ETH`);
          logger.error(`   💡 Fund this address: ${this.sequencerWallet.address}`);
          return;
        }
      } catch (error: any) {
        logger.error(`   ❌ Balance check error: ${error.message}`);
        return;
      }

      // Check 4: Gas price
      try {
        const feeData = await this.l1Provider.getFeeData();
        const gasPrice = feeData.gasPrice || 0n;
        logger.info(`   ⛽ Gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
        
        if (gasPrice > ethers.parseUnits('100', 'gwei')) {
          logger.warn(`   ⚠️  High gas price! Consider waiting.`);
        }
      } catch (error: any) {
        logger.warn(`   ⚠️  Gas price check failed: ${error.message}`);
        // Don't return - this is non-critical
      }

      // Check 5: Contract connection
      let currentBatchId: bigint;
      try {
        currentBatchId = await this.l1StateCommitment.currentBatchId();
        logger.info(`   📦 Current batch ID: ${currentBatchId}`);
      } catch (error: any) {
        logger.error(`   ❌ State commitment contract error: ${error.message}`);
        logger.error(`   💡 Check contract address: ${this.config.l1StateCommitmentAddress}`);
        return;
      }

      // ===================================================================
      // PREPARE BATCH DATA
      // ===================================================================
      logger.info(`\n📦 PREPARING BATCH...`);
      
      const lastBlock = await this.db.getLastBlock();
      if (!lastBlock) {
        logger.warn('   ❌ No last block found in database');
        return;
      }

      logger.info(`   L2 Block: #${lastBlock.number}`);
      logger.info(`   State Root: ${lastBlock.stateRoot.slice(0, 10)}...`);

      // Build transaction root
      logger.info(`   Building transaction root...`);
      const txRoot = buildTransactionRoot([lastBlock.hash]);
      logger.info(`   Tx Root: ${txRoot.slice(0, 10)}...`);

      // ===================================================================
      // SUBMIT TO L1
      // ===================================================================
      logger.info(`\n📤 SUBMITTING TO L1...`);

      // Estimate gas first
      let estimatedGas: bigint;
      try {
        estimatedGas = await this.l1StateCommitment.submitBatch.estimateGas(
          lastBlock.stateRoot,
          txRoot,
          lastBlock.number,
          '0x'
        );
        logger.info(`   ⛽ Estimated gas: ${estimatedGas.toString()}`);
      } catch (error: any) {
        logger.error(`   ❌ Gas estimation failed: ${error.message}`);
        logger.error(`   💡 This usually means the transaction will revert`);
        return;
      }


      // Submit transaction
      const tx = await this.l1StateCommitment.submitBatch(
        lastBlock.stateRoot,
        txRoot,
        lastBlock.number,
        '0x',
        {
          gasLimit: estimatedGas * 120n / 100n, // 20% buffer
        }
      );

      logger.info(`   ✅ Transaction sent!`);
      logger.info(`   📝 Tx Hash: ${tx.hash}`);
      logger.info(`   🔗 Etherscan: https://sepolia.etherscan.io/tx/${tx.hash}`);
      logger.info(`   ⏳ Waiting for confirmation...`);

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        logger.info(`\n   ✅ BATCH SUBMITTED SUCCESSFULLY!`);
        logger.info(`   ⛽ Gas used: ${receipt.gasUsed.toString()}`);
        logger.info(`   📦 L1 Block: ${receipt.blockNumber}`);
        logger.info(`   💰 Cost: ${ethers.formatEther(receipt.gasUsed * (receipt.gasPrice || 0n))} ETH\n`);
      } else {
        logger.error(`   ❌ Transaction reverted!`);
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

      logger.info(`   💾 Batch saved to database\n`);

    } catch (error: any) {
      logger.error(`\n❌ BATCH SUBMISSION FAILED!`);
      logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      // Error type
      logger.error(`Type: ${typeof error}`);
      
      // Error message
      if (error.message) {
        logger.error(`Message: ${error.message}`);
      }
      
      // Error code
      if (error.code) {
        logger.error(`Code: ${error.code}`);
      }

      // Revert reason
      if (error.reason) {
        logger.error(`Reason: ${error.reason}`);
      }

      // Transaction data
      if (error.transaction) {
        logger.error(`Transaction data:`);
        logger.error(`  From: ${error.transaction.from}`);
        logger.error(`  To: ${error.transaction.to}`);
        logger.error(`  Data: ${error.transaction.data?.slice(0, 66)}...`);
      }

      // Receipt (if available)
      if (error.receipt) {
        logger.error(`Receipt:`);
        logger.error(`  Status: ${error.receipt.status}`);
        logger.error(`  Gas used: ${error.receipt.gasUsed?.toString()}`);
      }

      // Inner error
      if (error.error) {
        logger.error(`Inner error: ${JSON.stringify(error.error, null, 2)}`);
      }

      // Stack trace
      if (error.stack) {
        logger.error(`Stack trace:`);
        logger.error(error.stack);
      }

      logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    }
  }

  private async getL2State(): Promise<StateEntry[]> {
    // Get balances of known addresses
    const addresses = [
      '0x050bf90cc79d7a4aca382b233002303fb7baa5a3',
      '0x90c7ced44627148a266bd875654299cfc474e347',
      '0x905179aa177fd8727ce67479fb562f2472704b31',
    ];

    const states: StateEntry[] = [];

    for (const address of addresses) {
      try {
        const balance = await this.l2Provider.getBalance(address);
        const nonce = await this.l2Provider.getTransactionCount(address);

        states.push({
          address,
          balance,
          nonce: BigInt(nonce),
        });
      } catch (error) {
        logger.debug(`Failed to get state for ${address}`);
      }
    }

    return states;
  }

  async stop(): Promise<void> {
    logger.info('\n🛑 Stopping sequencer...');

    if (this.blockInterval) clearInterval(this.blockInterval);
    if (this.batchInterval) clearInterval(this.batchInterval);

    this.l1Bridge.removeAllListeners();

    this.isRunning = false;
    logger.info('✅ Sequencer stopped');
  }
}