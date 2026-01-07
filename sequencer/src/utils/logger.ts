import winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';

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

// Custom format
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    
    // Add stack trace for errors
    if (stack) {
      log += `\n${stack}`;
    }
    
    return log;
  })
);

// Create logger
export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: customFormat,
  transports: [
    // Console output (colored)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        customFormat
      ),
    }),
    // File output
    new winston.transports.File({
      filename: LOG_FILE,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
});

// ═══════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════

export const logDeposit = (depositId: string, message: string, meta?: any) => {
  logger.info(`[DEPOSIT ${depositId.slice(0, 10)}...] ${message}`, meta);
};

export const logWithdrawal = (withdrawalId: string, message: string, meta?: any) => {
  logger.info(`[WITHDRAWAL ${withdrawalId.slice(0, 10)}...] ${message}`, meta);
};

export const logBatch = (batchNumber: bigint, message: string, meta?: any) => {
  logger.info(`[BATCH #${batchNumber}] ${message}`, meta);
};

export const logService = (serviceName: string, message: string, meta?: any) => {
  logger.info(`[${serviceName.toUpperCase()}] ${message}`, meta);
};

export default logger;