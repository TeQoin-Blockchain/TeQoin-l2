// ═══════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════

export interface Config {
  // L1 Configuration
  l1: {
    rpcUrl: string;
    wsUrl: string;
    chainId: number;
    diamondAddress: string;
  };

  // L2 Configuration
  l2: {
    rpcUrl: string;
    wsUrl: string;
    chainId: number;
    engineUrl: string;        // NEW: Engine API endpoint
    jwtSecretPath: string;
    contracts: {
      teqToken: string;
      bridge: string;
      staking: string;
    };
  };

  // Sequencer
  sequencer: {
    address: string;
    privateKey: string;
  };

  // Batch
  batch: {
    size: number;
    interval: number;
    gasLimit: number;
  };

  // Database
  database: {
    url: string;
  };

  // Logging
  logging: {
    level: string;
    file: string;
  };

  // Health Check
  healthCheck: {
    port: number;
  };

  // Advanced
  retry: {
    attempts: number;
    delay: number;
  };
  maxConcurrentDeposits: number;
}

// ───────────────────────────────────────────────────────
// DEPOSIT TYPES
// ───────────────────────────────────────────────────────

export interface Deposit {
  id?: number;
  depositId: string;
  tokenAddress: string;
  recipient: string;
  amount: string;
  l1BlockNumber: bigint;
  l1TxHash: string;
  processed: boolean;
  l2TxHash?: string;
  createdAt?: Date;
  processedAt?: Date;
}

export interface DepositEvent {
  depositId: string;
  token: string;
  recipient: string;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: string;
}

// ───────────────────────────────────────────────────────
// WITHDRAWAL TYPES
// ───────────────────────────────────────────────────────

export interface Withdrawal {
  id?: number;
  withdrawalId: string;
  tokenAddress: string;
  sender: string;
  recipient: string;
  amount: string;
  l2BlockNumber: bigint;
  l2TxHash: string;
  queued: boolean;
  finalized: boolean;
  l1TxHash?: string;
  createdAt?: Date;
  queuedAt?: Date;
  finalizedAt?: Date;
}

export interface WithdrawalEvent {
  withdrawalId: string;
  token: string;
  from: string;
  to: string;
  amount: bigint;
  nonce: bigint;
  blockNumber: bigint;
  transactionHash: string;
}

// ───────────────────────────────────────────────────────
// BATCH TYPES
// ───────────────────────────────────────────────────────

export interface Batch {
  id?: number;
  batchNumber: bigint;
  l2StartBlock: bigint;
  l2EndBlock: bigint;
  stateRoot: string;
  transactionsRoot: string;
  l1TxHash?: string;
  submitted: boolean;
  createdAt?: Date;
  submittedAt?: Date;
}

export interface BatchData {
  startBlock: bigint;
  endBlock: bigint;
  stateRoot: string;
  transactionsRoot: string;
  compressedData: string;
}

// ───────────────────────────────────────────────────────
// SERVICE STATUS TYPES
// ───────────────────────────────────────────────────────

export interface ServiceStatus {
  l1Listener: ServiceState;
  l2Processor: ServiceState;
  l2WithdrawalListener: ServiceState;
  batchSubmitter: ServiceState;
}

export enum ServiceState {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  ERROR = 'error',
  STOPPING = 'stopping',
}

// ───────────────────────────────────────────────────────
// STATISTICS TYPES
// ───────────────────────────────────────────────────────

export interface SequencerStats {
  depositsProcessed: number;
  withdrawalsQueued: number;
  batchesSubmitted: number;
  lastBatchBlock: bigint;
  lastDepositTime?: Date;
  lastWithdrawalTime?: Date;
  lastBatchTime?: Date;
}

// ───────────────────────────────────────────────────────
// HEALTH CHECK TYPES
// ───────────────────────────────────────────────────────

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: Date;
  services: ServiceStatus;
  stats: SequencerStats;
  uptime: number;
}

// ───────────────────────────────────────────────────────
// ERROR TYPES
// ───────────────────────────────────────────────────────

export class SequencerError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'SequencerError';
  }
}

export enum ErrorCode {
  CONFIG_ERROR = 'CONFIG_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  RPC_ERROR = 'RPC_ERROR',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
  PROCESSING_ERROR = 'PROCESSING_ERROR',
  BATCH_ERROR = 'BATCH_ERROR',
}