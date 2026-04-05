import { Router, Request, Response } from 'express';
import { getBlock, getLatestBlock, getLatestBlocks } from '../../database/queries/blocks';
import { getTransactionsByBlock } from '../../database/queries/transactions';
import { APIResponse, Block, Transaction } from '../../types';
import cacheService from '../../services/cache.service';
import logger from '../../utils/logger';

const router = Router();

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || `${fallback}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/**
 * GET /api/v1/block/latest
 * Get latest block
 */
router.get('/latest', async (_req: Request, res: Response) => {
  try {
    const block = await getLatestBlock();

    if (!block) {
      const response: APIResponse<null> = {
        success: false,
        error: 'No blocks found',
      };
      return res.status(404).json(response);
    }

    const response: APIResponse<Block> = {
      success: true,
      data: block,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching latest block', { error: error.message });

    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch latest block',
    };

    res.status(500).json(response);
  }
});

/**
 * GET /api/v1/block/recent?limit=20
 * Get latest blocks list
 */
router.get('/recent', async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit as string | undefined, 20, 100);
    const cacheKey = `block:recent:${limit}`;
    const cached = await cacheService.get<Block[]>(cacheKey);

    if (cached) {
      const response: APIResponse<Block[]> = {
        success: true,
        data: cached,
        meta: { limit },
      };
      return res.json(response);
    }

    const blocks = await getLatestBlocks(limit);
    await cacheService.set(cacheKey, blocks, 10);

    const response: APIResponse<Block[]> = {
      success: true,
      data: blocks,
      meta: { limit, total: blocks.length },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching recent blocks', { error: error.message });

    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch recent blocks',
    };

    res.status(500).json(response);
  }
});

/**
 * GET /api/v1/block/:number/transactions
 * Get transactions in a block
 */
router.get('/:number/transactions', async (req: Request, res: Response) => {
  try {
    const { number } = req.params;
    const blockNum = BigInt(number);

    // Check cache
    const cacheKey = `block:${number}:txs`;
    const cached = await cacheService.get<Transaction[]>(cacheKey);

    if (cached) {
      const response: APIResponse<Transaction[]> = {
        success: true,
        data: cached,
      };
      return res.json(response);
    }

    // Fetch from database
    const transactions = await getTransactionsByBlock(blockNum);

    // Cache result
    await cacheService.set(cacheKey, transactions, 300); // 5 minutes TTL

    const response: APIResponse<Transaction[]> = {
      success: true,
      data: transactions,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching block transactions', { error: error.message });

    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch block transactions',
    };

    res.status(500).json(response);
  }
});

/**
 * GET /api/v1/block/:numberOrHash
 * Get block by number or hash
 */
router.get('/:numberOrHash', async (req: Request, res: Response) => {
  try {
    const { numberOrHash } = req.params;

    // Check cache
    const cacheKey = `block:${numberOrHash}`;
    const cached = await cacheService.get<Block>(cacheKey);

    if (cached) {
      const response: APIResponse<Block> = {
        success: true,
        data: cached,
      };
      return res.json(response);
    }

    // Determine if it's a number or hash
    let block: Block | null;
    if (numberOrHash.startsWith('0x')) {
      block = await getBlock(numberOrHash);
    } else {
      const blockNum = BigInt(numberOrHash);
      block = await getBlock(blockNum);
    }

    if (!block) {
      const response: APIResponse<null> = {
        success: false,
        error: 'Block not found',
      };
      return res.status(404).json(response);
    }

    // Cache result
    await cacheService.set(cacheKey, block, 300);

    const response: APIResponse<Block> = {
      success: true,
      data: block,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching block', { error: error.message });

    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch block',
    };

    res.status(500).json(response);
  }
});

export default router;
