import { logger } from './logger';

// ═══════════════════════════════════════════════════════
// RETRY UTILITY WITH EXPONENTIAL BACKOFF
// ═══════════════════════════════════════════════════════

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
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { attempts, delay, exponential = true, onRetry } = options;
  
  let lastError: Error;
  
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === attempts) {
        throw lastError;
      }
      
      // Calculate delay (exponential backoff)
      const waitTime = exponential ? delay * Math.pow(2, attempt - 1) : delay;
      
      // Call onRetry callback
      if (onRetry) {
        onRetry(lastError, attempt);
      }
      
      logger.warn(`Retry attempt ${attempt}/${attempts} after ${waitTime}ms`, {
        error: lastError.message,
      });
      
      // Wait before retry
      await sleep(waitTime);
    }
  }
  
  throw lastError!;
}

/**
 * Sleep for specified milliseconds
 * @param ms Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with default config from environment
 */
export async function retryWithDefaults<T>(fn: () => Promise<T>): Promise<T> {
  const attempts = parseInt(process.env.RETRY_ATTEMPTS || '3');
  const delay = parseInt(process.env.RETRY_DELAY || '5000');
  
  return retry(fn, { attempts, delay });
}