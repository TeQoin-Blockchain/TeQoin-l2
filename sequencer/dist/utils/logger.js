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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logService = exports.logBatch = exports.logWithdrawal = exports.logDeposit = exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ═══════════════════════════════════════════════════════
// LOGGER CONFIGURATION
// ═══════════════════════════════════════════════════════
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FILE = process.env.LOG_FILE || './logs/sequencer.log';
// Create logs directory if it doesn't exist
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}
// Custom format with BigInt support
const customFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    // Add metadata if present (with BigInt serialization)
    if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta, (key, value) => typeof value === 'bigint' ? value.toString() : value)}`;
    }
    // Add stack trace for errors
    if (stack) {
        log += `\n${stack}`;
    }
    return log;
}));
// Create logger
exports.logger = winston_1.default.createLogger({
    level: LOG_LEVEL,
    format: customFormat,
    transports: [
        // Console output (colored)
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), customFormat),
        }),
        // File output
        new winston_1.default.transports.File({
            filename: LOG_FILE,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
        }),
    ],
});
// ═══════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════
const logDeposit = (depositId, message, meta) => {
    exports.logger.info(`[DEPOSIT ${depositId.slice(0, 10)}...] ${message}`, meta);
};
exports.logDeposit = logDeposit;
const logWithdrawal = (withdrawalId, message, meta) => {
    exports.logger.info(`[WITHDRAWAL ${withdrawalId.slice(0, 10)}...] ${message}`, meta);
};
exports.logWithdrawal = logWithdrawal;
const logBatch = (batchNumber, message, meta) => {
    exports.logger.info(`[BATCH #${batchNumber}] ${message}`, meta);
};
exports.logBatch = logBatch;
const logService = (serviceName, message, meta) => {
    exports.logger.info(`[${serviceName.toUpperCase()}] ${message}`, meta);
};
exports.logService = logService;
exports.default = exports.logger;
//# sourceMappingURL=logger.js.map