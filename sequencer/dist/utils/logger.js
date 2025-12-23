"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const logLevel = process.env.LOG_LEVEL || 'info';
const customFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.printf(({ timestamp, level, message, stack }) => {
    const emoji = {
        error: '❌',
        warn: '⚠️ ',
        info: 'ℹ️ ',
        debug: '🔍',
    }[level] || 'ℹ️ ';
    if (stack) {
        return `${emoji} ${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
    }
    return `${emoji} ${timestamp} [${level.toUpperCase()}]: ${message}`;
}));
exports.logger = winston_1.default.createLogger({
    level: logLevel,
    format: customFormat,
    transports: [
        new winston_1.default.transports.Console(),
        new winston_1.default.transports.File({
            filename: 'logs/error.log',
            level: 'error'
        }),
        new winston_1.default.transports.File({
            filename: 'logs/combined.log'
        }),
    ],
});
// Create logs directory
const fs_1 = require("fs");
if (!(0, fs_1.existsSync)('logs')) {
    (0, fs_1.mkdirSync)('logs');
}
//# sourceMappingURL=logger.js.map