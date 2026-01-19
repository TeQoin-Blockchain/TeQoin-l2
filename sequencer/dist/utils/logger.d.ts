import winston from 'winston';
export declare const logger: winston.Logger;
export declare const logDeposit: (depositId: string, message: string, meta?: any) => void;
export declare const logWithdrawal: (withdrawalId: string, message: string, meta?: any) => void;
export declare const logBatch: (batchNumber: bigint, message: string, meta?: any) => void;
export declare const logService: (serviceName: string, message: string, meta?: any) => void;
export default logger;
//# sourceMappingURL=logger.d.ts.map