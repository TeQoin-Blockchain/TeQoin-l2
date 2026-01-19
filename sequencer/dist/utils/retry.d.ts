export interface RetryOptions {
    attempts: number;
    delay: number;
    exponential?: boolean;
    onRetry?: (error: Error, attempt: number) => void;
}
/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry options
 * @returns Result of the function
 */
export declare function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
/**
 * Sleep for specified milliseconds
 * @param ms Milliseconds to sleep
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Retry with default config from environment
 */
export declare function retryWithDefaults<T>(fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=retry.d.ts.map