"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineAPIClient = void 0;
const fs = __importStar(require("fs"));
const logger_1 = require("../utils/logger");
class EngineAPIClient {
    jwt;
    endpoint;
    constructor(engineEndpoint, jwtSecretPath) {
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
            logger_1.logger.info('Engine API client initialized', { endpoint: engineEndpoint });
        }
        catch (error) {
            throw new Error(`Failed to read JWT secret: ${error}`);
        }
    }
    /**
     * Make authenticated request to Engine API
     */
    async request(method, params) {
        const jwt = await Promise.resolve().then(() => __importStar(require('jsonwebtoken')));
        // Create JWT token using proper library
        const jwtToken = jwt.sign({ iat: Math.floor(Date.now() / 1000) }, Buffer.from(this.jwt, 'hex'), { algorithm: 'HS256' });
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
    async newPayloadV1(payload) {
        logger_1.logger.debug('Sending newPayloadV1', {
            blockNumber: payload.blockNumber,
            blockHash: payload.blockHash,
            transactions: payload.transactions.length,
        });
        const result = await this.request('engine_newPayloadV1', [payload]);
        logger_1.logger.info('Payload submitted', {
            status: result.status,
            blockNumber: payload.blockNumber,
        });
        return result;
    }
    /**
     * engine_forkchoiceUpdatedV1 - Update fork choice
     */
    async forkchoiceUpdatedV1(forkchoiceState, payloadAttributes) {
        logger_1.logger.debug('Sending forkchoiceUpdatedV1', {
            head: forkchoiceState.headBlockHash.slice(0, 10) + '...',
        });
        const params = payloadAttributes
            ? [forkchoiceState, payloadAttributes]
            : [forkchoiceState];
        const result = await this.request('engine_forkchoiceUpdatedV1', params);
        logger_1.logger.info('Forkchoice updated', {
            status: result.payloadStatus.status,
        });
        return result;
    }
    /**
     * engine_getPayloadV1 - Get execution payload by ID
     */
    async getPayloadV1(payloadId) {
        logger_1.logger.debug('Getting payload', { payloadId });
        const result = await this.request('engine_getPayloadV1', [payloadId]);
        return result;
    }
    /**
     * Check Engine API connectivity
     */
    async ping() {
        try {
            // Use engine_exchangeCapabilities to test connectivity
            await this.request('engine_exchangeCapabilities', [[]]);
            return true;
        }
        catch (error) {
            logger_1.logger.error('Engine API ping failed', { error });
            return false;
        }
    }
}
exports.EngineAPIClient = EngineAPIClient;
exports.default = EngineAPIClient;
//# sourceMappingURL=engine-api-client.js.map