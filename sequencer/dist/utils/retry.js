"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retry = retry;
exports.sleep = sleep;
exports.retryWithDefaults = retryWithDefaults;
const logger_1 = require("./logger");
/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry options
 * @returns Result of the function
 */
async function retry(fn, options) {
    const { attempts, delay, exponential = true, onRetry } = options;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt === attempts) {
                throw lastError;
            }
            // Calculate delay (exponential backoff)
            const waitTime = exponential ? delay * Math.pow(2, attempt - 1) : delay;
            // Call onRetry callback
            if (onRetry) {
                onRetry(lastError, attempt);
            }
            logger_1.logger.warn(`Retry attempt ${attempt}/${attempts} after ${waitTime}ms`, {
                error: lastError.message,
            });
            // Wait before retry
            await sleep(waitTime);
        }
    }
    throw lastError;
}
/**
 * Sleep for specified milliseconds
 * @param ms Milliseconds to sleep
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Retry with default config from environment
 */
async function retryWithDefaults(fn) {
    const attempts = parseInt(process.env.RETRY_ATTEMPTS || '3');
    const delay = parseInt(process.env.RETRY_DELAY || '5000');
    return retry(fn, { attempts, delay });
}
//# sourceMappingURL=retry.js.map