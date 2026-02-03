import { ethers } from 'ethers';
import { MerkleTree } from 'merkletreejs';
import { Config } from '../types';
import { logger, logService, logBatch } from '../utils/logger';
import { saveBatch, markBatchSubmitted, getWithdrawalsInRange, markWithdrawalQueued } from '../database/models';
import { retryWithDefaults } from '../utils/retry';

// ═══════════════════════════════════════════════════════
// BATCH SUBMITTER SERVICE (FIXED)
// Purpose: Submit L2 batches to L1 with withdrawal Merkle proofs
// ═══════════════════════════════════════════════════════

interface Withdrawal {
  withdrawalId: string;
  tokenAddress: string;
  sender: string;
  recipient: string;
  amount: string;
  l2BlockNumber: bigint;
}

export class BatchSubmitterService {
  private l1Provider: ethers.JsonRpcProvider | null = null;
  private l2Provider: ethers.JsonRpcProvider | null = null;
  private wallet: ethers.Wallet | null = null;
  private sequencerFacet: ethers.Contract | null = null;
  private bridgeFacet: ethers.Contract | null = null;
  private isRunning: boolean = false;
  private isSubmitting: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  
  constructor(private config: Config) {}
  
  /**
   * Start batch submission
   */
  async start(): Promise<void> {
    logService('BATCH-SUBMITTER', 'Starting...');
    
    try {
      // Connect to L1
      this.l1Provider = new ethers.JsonRpcProvider(this.config.l1.rpcUrl);
      
      // Connect to L2
      this.l2Provider = new ethers.JsonRpcProvider(this.config.l2.rpcUrl);
      
      // Create wallet
      this.wallet = new ethers.Wallet(
        this.config.sequencer.privateKey,
        this.l1Provider
      );
      
      // Create contract instances
      this.sequencerFacet = new ethers.Contract(
        this.config.l1.diamondAddress,
        SEQUENCER_FACET_ABI,
        this.wallet
      );
      
      this.bridgeFacet = new ethers.Contract(
        this.config.l1.diamondAddress,
        BRIDGE_FACET_ABI,
        this.wallet
      );
      
      this.isRunning = true;
      
      // Start batch submission loop
      this.intervalId = setInterval(() => {
        this.submitBatch().catch((error) => {
          logger.error('Error in batch submission loop', { error });
        });
      }, this.config.batch.interval * 1000);
      
      logService('BATCH-SUBMITTER', 'Started successfully', {
        diamondAddress: this.config.l1.diamondAddress,
        batchSize: this.config.batch.size,
        batchInterval: this.config.batch.interval,
      });
      
    } catch (error) {
      logService('BATCH-SUBMITTER', 'Failed to start', { error });
      throw error;
    }
  }
  
  /**
   * Submit batch to L1 with withdrawal Merkle proofs
   */
  private async submitBatch(): Promise<void> {
    if (!this.isRunning || this.isSubmitting) {
      return;
    }
    
    this.isSubmitting = true;
    
    try {
      // Get current L2 block
      const currentBlock = await this.l2Provider!.getBlockNumber();
      
      // Get last submitted block from L1
      const lastSubmitted = await this.sequencerFacet!.getLatestL2Block();
      
      // Calculate next rotation boundary
      const nextRotationBlock = lastSubmitted + BigInt(this.config.batch.size);
      
      // Check if L2 has reached rotation boundary
      if (BigInt(currentBlock) < nextRotationBlock) {
        const blocksRemaining = nextRotationBlock - BigInt(currentBlock);
        logService('BATCH-SUBMITTER', 'Waiting for next rotation boundary', {
          currentBlock,
          nextRotation: nextRotationBlock.toString(),
          blocksRemaining: blocksRemaining.toString(),
        });
        return;
      }
      
      logBatch(nextRotationBlock, `Preparing batch for block ${nextRotationBlock}`);
      
      const startBlock = lastSubmitted + 1n;
      const endBlock = nextRotationBlock;
      
      // ═══════════════════════════════════════════════════════
      // STEP 1: Fetch withdrawals from database
      // ═══════════════════════════════════════════════════════
      const withdrawals = await getWithdrawalsInRange(startBlock, endBlock);
      
      logBatch(nextRotationBlock, `Found ${withdrawals.length} withdrawals in batch`);
      
      // ═══════════════════════════════════════════════════════
      // STEP 2: Build Merkle tree from withdrawals
      // ═══════════════════════════════════════════════════════
      let merkleRoot: string;
      let merkleTree: MerkleTree | null = null;
      
      if (withdrawals.length > 0) {
        const leaves = withdrawals.map(w => this.createWithdrawalLeaf(w));
        merkleTree = new MerkleTree(leaves, ethers.keccak256, { sortPairs: true });
        merkleRoot = merkleTree.getHexRoot();
        
        logBatch(nextRotationBlock, 'Built Merkle tree', {
          leaves: leaves.length,
          merkleRoot,
        });
      } else {
        // No withdrawals: use zero hash
        merkleRoot = ethers.keccak256(ethers.toUtf8Bytes(""));
        logBatch(nextRotationBlock, 'No withdrawals in batch, using zero hash');
      }
      
      // ═══════════════════════════════════════════════════════
      // STEP 3: Get transactions root from L2 block
      // ═══════════════════════════════════════════════════════
      const block = await this.l2Provider!.getBlock(Number(endBlock));
      const transactionsRoot = block?.hash || ethers.ZeroHash;
      
      // ═══════════════════════════════════════════════════════
      // STEP 4: Submit batch to L1
      // ═══════════════════════════════════════════════════════
      logBatch(nextRotationBlock, 'Submitting batch to L1...');
      
      const submitTx = await retryWithDefaults(async () => {
        return await this.sequencerFacet!.submitBatch(
          nextRotationBlock,    // l2BlockNumber
          merkleRoot,           // stateRoot (withdrawal Merkle root)
          transactionsRoot      // transactionsRoot
        );
      });
      
      logBatch(nextRotationBlock, 'Batch transaction sent', { hash: submitTx.hash });
      
      const submitReceipt = await submitTx.wait(1);
      
      if (!submitReceipt || submitReceipt.status !== 1) {
        throw new Error('Batch submission failed');
      }
      
      logBatch(nextRotationBlock, 'Batch submitted successfully', {
        txHash: submitTx.hash,
        gasUsed: submitReceipt.gasUsed.toString(),
      });
      
      // ═══════════════════════════════════════════════════════
      // STEP 5: Queue each withdrawal on L1 with Merkle proof
      // ═══════════════════════════════════════════════════════
      if (withdrawals.length > 0 && merkleTree) {
        logBatch(nextRotationBlock, `Queueing ${withdrawals.length} withdrawals on L1...`);
        
        for (const withdrawal of withdrawals) {
          try {
            await this.queueWithdrawalOnL1(withdrawal, merkleTree);
          } catch (error: any) {
            logger.error('Failed to queue withdrawal', {
              withdrawalId: withdrawal.withdrawalId,
              error: error.message,
            });
            // Continue with other withdrawals
          }
        }
      }
      
      // ═══════════════════════════════════════════════════════
      // STEP 6: Save batch to database
      // ═══════════════════════════════════════════════════════
      const batchNumber = nextRotationBlock / BigInt(this.config.batch.size);
      
      await saveBatch({
        batchNumber,
        l2StartBlock: startBlock,
        l2EndBlock: endBlock,
        stateRoot: merkleRoot,
        transactionsRoot,
        submitted: false,
      });
      
      await markBatchSubmitted(batchNumber, submitTx.hash);
      
      logBatch(batchNumber, 'Batch processing complete', {
        withdrawalsProcessed: withdrawals.length,
      });
      
    } catch (error: any) {
      logger.error('Failed to submit batch', { 
        error: error.message || String(error),
        stack: error.stack,
      });
    } finally {
      this.isSubmitting = false;
    }
  }
  
  /**
   * Create Merkle leaf for withdrawal
   * MUST MATCH L1 CONTRACT: keccak256(abi.encodePacked(withdrawalId, token, to, amount))
   */
  private createWithdrawalLeaf(withdrawal: Withdrawal): Buffer {
    const encoded = ethers.solidityPacked(
      ['bytes32', 'address', 'address', 'uint256'],
      [
        withdrawal.withdrawalId,
        withdrawal.tokenAddress,
        withdrawal.recipient,
        withdrawal.amount,
      ]
    );
    
    const hash = ethers.keccak256(encoded);
    return Buffer.from(hash.slice(2), 'hex');
  }
  
  /**
   * Queue withdrawal on L1 with Merkle proof
   */
  private async queueWithdrawalOnL1(
    withdrawal: Withdrawal,
    merkleTree: MerkleTree
  ): Promise<void> {
    try {
      // Generate Merkle proof
      const leaf = this.createWithdrawalLeaf(withdrawal);
      const proof = merkleTree.getHexProof(leaf);
      
      // Encode proof as bytes (ABI encode bytes32[] array)
      const encodedProof = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32[]'],
        [proof]
      );
      
      logService('BATCH-SUBMITTER', `Queueing withdrawal ${withdrawal.withdrawalId.slice(0, 10)}...`);
      
      // Call queueWithdrawal on L1
      const tx = await retryWithDefaults(async () => {
        return await this.bridgeFacet!.queueWithdrawal(
          withdrawal.withdrawalId,
          withdrawal.tokenAddress,
          withdrawal.recipient,
          withdrawal.amount,
          encodedProof
        );
      });
      
      logService('BATCH-SUBMITTER', `Withdrawal queue tx sent`, { hash: tx.hash });
      
      const receipt = await tx.wait(1);
      
      if (receipt && receipt.status === 1) {
        // Mark as queued in database
        await markWithdrawalQueued(withdrawal.withdrawalId, tx.hash);
        
        logService('BATCH-SUBMITTER', `Withdrawal queued successfully`, {
          withdrawalId: withdrawal.withdrawalId.slice(0, 10),
          txHash: tx.hash,
        });
      } else {
        throw new Error('Queue withdrawal transaction failed');
      }
      
    } catch (error: any) {
      logger.error('Failed to queue withdrawal on L1', {
        withdrawalId: withdrawal.withdrawalId,
        error: error.message,
      });
      throw error;
    }
  }
  
  /**
   * Stop batch submission
   */
  async stop(): Promise<void> {
    logService('BATCH-SUBMITTER', 'Stopping...');
    
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    logService('BATCH-SUBMITTER', 'Stopped');
  }
  
  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// ═══════════════════════════════════════════════════════
// CONTRACT ABIs
// ═══════════════════════════════════════════════════════

const SEQUENCER_FACET_ABI = [
  'function submitBatch(uint256 l2BlockNumber, bytes32 stateRoot, bytes32 transactionsRoot) external',
  'function getLatestL2Block() external view returns (uint256)',
];

const BRIDGE_FACET_ABI = [
  'function queueWithdrawal(bytes32 withdrawalId, address token, address to, uint256 amount, bytes memory proof) external',
];

export default BatchSubmitterService;