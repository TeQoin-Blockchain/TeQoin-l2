export interface Block {
  number: bigint;
  hash: string;
  parentHash: string;
  timestamp: bigint;
  miner: string;
  gasUsed: bigint;
  gasLimit: bigint;
  transactionCount: number;
}

export interface Transaction {
  hash: string;
  blockNumber: bigint;
  transactionIndex: number;
  fromAddress: string;
  toAddress: string | null;
  value: string;
  gasPrice: bigint;
  gasUsed: bigint;
  gasLimit: bigint;
  effectiveGasPrice: bigint;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  baseFeePerGas: bigint | null;
  txType: number;
  input: string;
  nonce: bigint;
  status: boolean;
  timestamp: bigint;
}

export type TransactionClassification = 'contract_creation' | 'contract_call' | 'eoa_transfer';
export type TransactionCategory = 'normal' | 'token_transfer' | 'contract_call' | 'internal' | 'other';
export type BridgeTxRole = 'source' | 'settlement';
export type BridgeTxPhase = 'l1_source' | 'l2_settlement' | 'l2_source' | 'l1_settlement';
export type BridgeActivityType = 'bridge_deposit' | 'bridge_withdrawal';

export interface BridgeTransactionLink {
  bridgeId: string;
  direction: BridgeDirection;
  role: BridgeTxRole;
  phase: BridgeTxPhase;
  activityType: BridgeActivityType;
  status: string;
  tokenAddress: string | null;
  amount: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  l1Timestamp: bigint | null;
  l1QueueTimestamp: bigint | null;
  l1FinalizationTimestamp: bigint | null;
  l2Timestamp: bigint | null;
  l1TokenAddress?: string | null;
  l2TokenAddress?: string | null;
  sourceTokenAddress?: string | null;
  destinationTokenAddress?: string | null;
  challengePeriodSeconds?: number | null;
  challengePeriodEndTimestamp?: bigint | null;
  challengePeriodRemainingSeconds?: number | null;
  challengePeriodElapsedSeconds?: number | null;
  isChallengePeriodActive?: boolean;
  finalizedByRelayer?: boolean;
}

export interface EnrichedTransaction extends Transaction {
  fee: string;
  gasPriceBid: string;
  gasPricePaid: string;
  gasFeeBase: string | null;
  gasFeeMax: string | null;
  gasFeeMaxPriority: string | null;
  classification: TransactionClassification;
  isContractCall: boolean;
  tokenAddress?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenDecimals?: number | null;
  txCategory: TransactionCategory;
  hasErc20Transfer: boolean;
  hasInternalTransfers: boolean;
  isBridgeTransaction?: boolean;
  bridgeContext?: BridgeTransactionLink | null;
}


export interface AddressTransaction extends Transaction {
  tokenAddress?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenDecimals?: number | null;
  txCategory: TransactionCategory;
  hasErc20Transfer: boolean;
  hasInternalTransfers: boolean;
  isBridgeTransaction?: boolean;
  bridgeContext?: BridgeTransactionLink | null;
}

export interface Log {
  transactionHash: string;
  blockNumber: bigint;
  logIndex: number;
  address: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string;
}

export interface Contract {
  address: string;
  deployer: string;
  transactionHash: string;
  blockNumber: bigint;
  bytecode: string;
}

export interface IndexerState {
  key: string;
  value: string;
  updatedAt: Date;
}

export type BridgeDirection = 'l1_to_l2' | 'l2_to_l1';

export interface BridgeRecord {
  bridgeId: string;
  direction: BridgeDirection;
  tokenAddress: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  l1TxHash: string | null;
  l1BlockNumber: bigint | null;
  l1Timestamp: bigint | null;
  l1QueueTxHash: string | null;
  l1QueueBlockNumber: bigint | null;
  l1QueueTimestamp: bigint | null;
  l1FinalizationTxHash: string | null;
  l1FinalizationBlockNumber: bigint | null;
  l1FinalizationTimestamp: bigint | null;
  l2TxHash: string | null;
  l2BlockNumber: bigint | null;
  l2Timestamp: bigint | null;
  l1TokenAddress?: string | null;
  l2TokenAddress?: string | null;
  sourceTokenAddress?: string | null;
  destinationTokenAddress?: string | null;
  status: string;
  updatedAt: Date;
}

export interface BridgeRecordWithChallenge extends BridgeRecord {
  challengePeriodSeconds: number | null;
  challengePeriodEndTimestamp: bigint | null;
  challengePeriodRemainingSeconds: number | null;
  challengePeriodElapsedSeconds: number | null;
  isChallengePeriodActive: boolean;
  finalizedByRelayer: boolean;
}

export interface Config {
  database: {
    url: string;
  };
  l1: {
    rpcUrl: string;
    chainId: number;
  };
  l2: {
    rpcUrl: string;
    wsUrl: string;
    chainId: number;
  };
  bridge: {
    enabled: boolean;
    l1Address: string;
    l2Address: string;
    l2Addresses: string[];
    challengePeriodSeconds: number;
    pollInterval: number;
    batchSize: number;
    startL1Block: number;
    startL2Block: number;
  };
  api: {
    port: number;
    host: string;
  };
  indexer: {
    startBlock: number;
    batchSize: number;
    pollInterval: number;
  };
  redis?: {
    url: string;
  };
  logLevel: string;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    offset?: number;
    total?: number;
  };
}

export interface TransactionListParams {
  address?: string;
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
  offset?: number;
}

export interface StatsResponse {
  totalBlocks: number;
  totalTransactions: number;
  totalSendTransactions: number;
  totalErc20Transactions: number;
  totalBridgeTransactions: number;
  lastIndexedBlock: number;
  indexerStatus: string;
  indexerUptime: string;
}

export interface TPSMetric {
  windowSeconds: number;
  transactionCount: number;
  tps: number;
}

export interface GasMetrics {
  windowSeconds: number;
  sampleSize: number;
  avgGasUsed: string;
  medianGasUsed: string;
  avgGasPrice: string;
  medianGasPrice: string;
}
