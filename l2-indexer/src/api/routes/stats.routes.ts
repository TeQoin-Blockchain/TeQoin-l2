import { Router, Request, Response } from 'express';
import { getBlockCount } from '../../database/queries/blocks';
import { getTransactionStatsCounts } from '../../database/queries/transactions';
import { getBridgeTransactionCount } from '../../database/queries/bridge';
import { getState, getIndexerStatus } from '../../database/queries/state';
import { APIResponse, StatsResponse } from '../../types';
import logger from '../../utils/logger';

const router = Router();

/**
 * GET /api/v1/stats
 * Get indexer statistics
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const totalBlocks = await getBlockCount();
    const transactionCounts = await getTransactionStatsCounts();
    const totalBridgeTransactions = await getBridgeTransactionCount();
    const lastIndexedBlock = await getState('last_indexed_block');
    const indexerStatus = await getIndexerStatus();
    const startedAt = await getState('indexer_started_at');
    
    // Calculate uptime
    let uptime = 'unknown';
    if (startedAt && startedAt !== '') {
      const startTime = new Date(startedAt).getTime();
      const now = Date.now();
      const uptimeMs = now - startTime;
      uptime = formatUptime(uptimeMs);
    }
    
    const stats: StatsResponse = {
      totalBlocks,
      totalTransactions: transactionCounts.totalTransactions,
      totalSendTransactions: transactionCounts.totalSendTransactions,
      totalErc20Transactions: transactionCounts.totalErc20Transactions,
      totalBridgeTransactions,
      lastIndexedBlock: parseInt(lastIndexedBlock || '0'),
      indexerStatus,
      indexerUptime: uptime,
    };
    
    const response: APIResponse<StatsResponse> = {
      success: true,
      data: stats,
    };
    
    res.json(response);
    
  } catch (error: any) {
    logger.error('Error fetching stats', { error: error.message });
    
    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch statistics',
    };
    
    res.status(500).json(response);
  }
});

/**
 * GET /api/v1/health
 * Health check endpoint
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const status = await getIndexerStatus();
    
    const response = {
      status: status === 'running' ? 'healthy' : 'unhealthy',
      indexer: status,
      timestamp: new Date().toISOString(),
    };
    
    res.json(response);
    
  } catch (error: any) {
    logger.error('Error in health check', { error: error.message });
    
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export default router;
