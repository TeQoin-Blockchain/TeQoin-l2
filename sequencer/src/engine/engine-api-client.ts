import { ethers } from 'ethers';
import * as fs from 'fs';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════
// ENGINE API CLIENT
// Implements Ethereum Engine API for post-merge consensus
// ═══════════════════════════════════════════════════════

export interface ExecutionPayload {
  parentHash: string;
  feeRecipient: string;
  stateRoot: string;
  receiptsRoot: string;
  logsBloom: string;
  prevRandao: string;
  blockNumber: string;
  gasLimit: string;
  gasUsed: string;
  timestamp: string;
  extraData: string;
  baseFeePerGas: string;
  blockHash: string;
  transactions: string[];
}

export interface ForkchoiceState {
  headBlockHash: string;
  safeBlockHash: string;
  finalizedBlockHash: string;
}

export interface PayloadAttributes {
  timestamp: string;
  prevRandao: string;
  suggestedFeeRecipient: string;
  withdrawals?: Withdrawal[];
}
export interface Withdrawal {
  index: string;
  validatorIndex: string;
  address: string;
  amount: string;
}
export interface ExecutionPayloadV2 extends ExecutionPayload {
  withdrawals: Withdrawal[];
}

export class EngineAPIClient {
  private jwt: string;
  private endpoint: string;
  
  constructor(engineEndpoint: string, jwtSecretPath: string) {
    this.endpoint = engineEndpoint;
    
    // Read JWT secret
    try {
      const jwtSecret = fs.readFileSync(jwtSecretPath, 'utf-8').trim();
      // Create JWT token (HS256)
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000) })).toString('base64url');
      
      // For simplicity, we'll use a library for proper JWT signing
      // In production, use 'jsonwebtoken' package
      this.jwt = jwtSecret; // Store secret for now
      
      logger.info('Engine API client initialized', { endpoint: engineEndpoint });
    } catch (error) {
      throw new Error(`Failed to read JWT secret: ${error}`);
    }
  }
  
  /**
   * Make authenticated request to Engine API
   */
  private async request(method: string, params: any[]): Promise<any> {
    const jwt = await import('jsonwebtoken');
    
    // Create JWT token using proper library
    const jwtToken = jwt.sign(
      { iat: Math.floor(Date.now() / 1000) },
      Buffer.from(this.jwt, 'hex'),
      { algorithm: 'HS256' }
    );
    
    // Make request
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: 1,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Engine API request failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data && typeof data === 'object' && 'error' in data) {
      throw new Error(`Engine API error: ${JSON.stringify(data.error)}`);
    }
    
    if (data && typeof data === 'object' && 'result' in data) {
      return data.result;
    }
    
    throw new Error('Invalid Engine API response');
  }
  
  /**
   * engine_newPayloadV1 - Submit new execution payload
   */
    async forkchoiceUpdatedV2(
    forkchoiceState: ForkchoiceState,
    payloadAttributes?: PayloadAttributes
  ): Promise<{
    payloadStatus: {
      status: 'VALID' | 'INVALID' | 'SYNCING';
      latestValidHash: string | null;
      validationError: string | null;
    };
    payloadId: string | null;
  }> {
    logger.debug('engine_forkchoiceUpdatedV2', {
      head: forkchoiceState.headBlockHash.slice(0, 10) + '...',
    });

    const params = payloadAttributes
      ? [forkchoiceState, payloadAttributes]
      : [forkchoiceState];

    return this.request('engine_forkchoiceUpdatedV2', params);
  }

  async getPayloadV2(payloadId: string): Promise<{
    executionPayload: ExecutionPayloadV2;
    blockValue : string;
  }> {
    logger.debug('engine_getPayloadV2', { payloadId });
    return this.request('engine_getPayloadV2', [payloadId]);
  }

  async newPayloadV2(
    payload: ExecutionPayloadV2
  ): Promise<{
    status: 'VALID' | 'INVALID' | 'SYNCING' | 'ACCEPTED';
    latestValidHash: string | null;
    validationError: string | null;
  }> {
    logger.debug('engine_newPayloadV2', {
      blockNumber: payload.blockNumber,
      withdrawals: payload.withdrawals.length,
    });

    return this.request('engine_newPayloadV2', [payload]);
  }
  async newPayloadV1(payload: ExecutionPayload): Promise<{
    status: 'VALID' | 'INVALID' | 'SYNCING' | 'ACCEPTED';
    latestValidHash: string | null;
    validationError: string | null;
  }> {
    logger.debug('Sending newPayloadV1', {
      blockNumber: payload.blockNumber,
      blockHash: payload.blockHash,
      transactions: payload.transactions.length,
    });
    
    const result = await this.request('engine_newPayloadV1', [payload]);
    
    logger.info('Payload submitted', {
      status: result.status,
      blockNumber: payload.blockNumber,
    });
    
    return result;
  }
  
  /**
   * engine_forkchoiceUpdatedV1 - Update fork choice
   */
  async forkchoiceUpdatedV1(
    forkchoiceState: ForkchoiceState,
    payloadAttributes?: PayloadAttributes
  ): Promise<{
    payloadStatus: {
      status: 'VALID' | 'INVALID' | 'SYNCING';
      latestValidHash: string | null;
      validationError: string | null;
    };
    payloadId: string | null;
  }> {
    logger.debug('Sending forkchoiceUpdatedV1', {
      head: forkchoiceState.headBlockHash.slice(0, 10) + '...',
    });
    
    const params = payloadAttributes
      ? [forkchoiceState, payloadAttributes]
      : [forkchoiceState];
    
    const result = await this.request('engine_forkchoiceUpdatedV1', params);
    
    logger.info('Forkchoice updated', {
      status: result.payloadStatus.status,
    });
    
    return result;
  }
  
  /**
   * engine_getPayloadV1 - Get execution payload by ID
   */
  async getPayloadV1(payloadId: string): Promise<ExecutionPayload> {
    logger.debug('Getting payload', { payloadId });
    
    const result = await this.request('engine_getPayloadV1', [payloadId]);
    
    return result;
  }
  
  /**
   * Check Engine API connectivity
   */
  async ping(): Promise<boolean> {
    try {
      // Use engine_exchangeCapabilities to test connectivity
      await this.request('engine_exchangeCapabilities', [[]]);
      return true;
    } catch (error) {
      logger.error('Engine API ping failed', { error });
      return false;
    }
  }
}

export default EngineAPIClient;