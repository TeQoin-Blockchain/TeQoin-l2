import config from '../../config';
import { Log, BridgeRecord, BridgeRecordWithChallenge, BridgeTransactionLink } from '../../types';

const ERC20_TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_TOPIC = `0x000000000000000000000000${ZERO_ADDRESS.slice(2)}`;

function isNativeTokenAddress(tokenAddress: string | null): boolean {
  return tokenAddress === null || tokenAddress.toLowerCase() === ZERO_ADDRESS;
}

function inferL2TokenAddress(
  direction: 'l1_to_l2' | 'l2_to_l1',
  tokenAddress: string | null,
  l2TxHash: string | null,
  logsByTxHash: Map<string, Log[]>
): string | null {
  if (tokenAddress === null) return null;
  if (isNativeTokenAddress(tokenAddress)) return ZERO_ADDRESS;
  if (!l2TxHash) return null;

  const logs = logsByTxHash.get(l2TxHash.toLowerCase()) || [];
  const transferLogs = logs.filter((log) => log.topic0?.toLowerCase() === ERC20_TRANSFER_TOPIC0);

  if (transferLogs.length === 0) return null;

  if (direction === 'l1_to_l2') {
    const mintLog = transferLogs.find((log) => log.topic1?.toLowerCase() === ZERO_TOPIC);
    if (mintLog) return mintLog.address.toLowerCase();
  }

  if (direction === 'l2_to_l1') {
    const burnLog = transferLogs.find((log) => log.topic2?.toLowerCase() === ZERO_TOPIC);
    if (burnLog) return burnLog.address.toLowerCase();
  }

  return transferLogs[0].address.toLowerCase();
}

export function buildLogsByTxHash(logs: Log[]): Map<string, Log[]> {
  const logsByTxHash = new Map<string, Log[]>();

  for (const log of logs) {
    const key = log.transactionHash.toLowerCase();
    const bucket = logsByTxHash.get(key) || [];
    bucket.push(log);
    logsByTxHash.set(key, bucket);
  }

  return logsByTxHash;
}

export function enrichBridgeLink(
  bridgeLink: BridgeTransactionLink,
  l2TokenAddress?: string | null
): BridgeTransactionLink {
  const normalizedL1TokenAddress =
    bridgeLink.tokenAddress !== null ? bridgeLink.tokenAddress.toLowerCase() : null;
  const normalizedL2TokenAddress =
    l2TokenAddress !== undefined
      ? l2TokenAddress !== null
        ? l2TokenAddress.toLowerCase()
        : null
      : isNativeTokenAddress(normalizedL1TokenAddress)
        ? ZERO_ADDRESS
        : null;

  const sourceTokenAddress =
    bridgeLink.direction === 'l1_to_l2' ? normalizedL1TokenAddress : normalizedL2TokenAddress;
  const destinationTokenAddress =
    bridgeLink.direction === 'l1_to_l2' ? normalizedL2TokenAddress : normalizedL1TokenAddress;

  const isL2Withdrawal = bridgeLink.direction === 'l2_to_l1' && bridgeLink.l2Timestamp !== null;
  const isFinalized = bridgeLink.status === 'finalized';
  const isChallenged = bridgeLink.status === 'challenged';

  if (!isL2Withdrawal) {
    return {
      ...bridgeLink,
      tokenAddress: sourceTokenAddress,
      l1TokenAddress: normalizedL1TokenAddress,
      l2TokenAddress: normalizedL2TokenAddress,
      sourceTokenAddress,
      destinationTokenAddress,
      challengePeriodSeconds: null,
      challengePeriodEndTimestamp: null,
      challengePeriodRemainingSeconds: null,
      challengePeriodElapsedSeconds: null,
      isChallengePeriodActive: false,
      finalizedByRelayer: Boolean(bridgeLink.l1FinalizationTimestamp),
    };
  }

  const challengePeriodSeconds = config.bridge.challengePeriodSeconds;
  const startTimestamp = Number(bridgeLink.l2Timestamp);
  const endTimestamp = startTimestamp + challengePeriodSeconds;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const remainingSeconds = Math.max(0, endTimestamp - nowSeconds);
  const elapsedSeconds = Math.max(0, nowSeconds - startTimestamp);

  return {
    ...bridgeLink,
    tokenAddress: sourceTokenAddress,
    l1TokenAddress: normalizedL1TokenAddress,
    l2TokenAddress: normalizedL2TokenAddress,
    sourceTokenAddress,
    destinationTokenAddress,
    challengePeriodSeconds,
    challengePeriodEndTimestamp: BigInt(endTimestamp),
    challengePeriodRemainingSeconds: isFinalized || isChallenged ? 0 : remainingSeconds,
    challengePeriodElapsedSeconds: elapsedSeconds,
    isChallengePeriodActive: !isFinalized && !isChallenged && remainingSeconds > 0,
    finalizedByRelayer: Boolean(bridgeLink.l1FinalizationTimestamp),
  };
}

export function enrichBridgeRecord(
  record: BridgeRecord,
  logsByTxHash: Map<string, Log[]>
): BridgeRecordWithChallenge {
  const normalizedL1TokenAddress =
    record.tokenAddress !== null ? record.tokenAddress.toLowerCase() : null;
  const normalizedL2TokenAddress = inferL2TokenAddress(
    record.direction,
    normalizedL1TokenAddress,
    record.l2TxHash,
    logsByTxHash
  );

  const sourceTokenAddress =
    record.direction === 'l1_to_l2' ? normalizedL1TokenAddress : normalizedL2TokenAddress;
  const destinationTokenAddress =
    record.direction === 'l1_to_l2' ? normalizedL2TokenAddress : normalizedL1TokenAddress;

  const isL2Withdrawal = record.direction === 'l2_to_l1' && record.l2Timestamp !== null;
  const supportsChallengeWindow = isL2Withdrawal && !['finalized', 'challenged'].includes(record.status);

  if (!supportsChallengeWindow) {
    return {
      ...record,
      tokenAddress: sourceTokenAddress,
      l1TokenAddress: normalizedL1TokenAddress,
      l2TokenAddress: normalizedL2TokenAddress,
      sourceTokenAddress,
      destinationTokenAddress,
      challengePeriodSeconds: isL2Withdrawal ? config.bridge.challengePeriodSeconds : null,
      challengePeriodEndTimestamp: null,
      challengePeriodRemainingSeconds: null,
      challengePeriodElapsedSeconds: null,
      isChallengePeriodActive: false,
      finalizedByRelayer: Boolean(record.l1FinalizationTxHash),
    };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const startTimestamp = Number(record.l2Timestamp);
  const endTimestamp = startTimestamp + config.bridge.challengePeriodSeconds;
  const remainingSeconds = Math.max(0, endTimestamp - nowSeconds);
  const elapsedSeconds = Math.max(0, nowSeconds - startTimestamp);

  return {
    ...record,
    tokenAddress: sourceTokenAddress,
    l1TokenAddress: normalizedL1TokenAddress,
    l2TokenAddress: normalizedL2TokenAddress,
    sourceTokenAddress,
    destinationTokenAddress,
    challengePeriodSeconds: config.bridge.challengePeriodSeconds,
    challengePeriodEndTimestamp: BigInt(endTimestamp),
    challengePeriodRemainingSeconds: remainingSeconds,
    challengePeriodElapsedSeconds: elapsedSeconds,
    isChallengePeriodActive: remainingSeconds > 0,
    finalizedByRelayer: Boolean(record.l1FinalizationTxHash),
  };
}
