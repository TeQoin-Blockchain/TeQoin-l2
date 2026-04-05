import { Router, Request, Response } from 'express';
import {
  getBridgeById,
  getLatestBridgeActivity,
  getLatestBridgeByDirection,
} from '../../database/queries/bridge';
import { APIResponse, BridgeRecordWithChallenge } from '../../types';
import { getLogsByTransactionHashes } from '../../database/queries/logs';
import cacheService from '../../services/cache.service';
import logger from '../../utils/logger';
import { buildLogsByTxHash, enrichBridgeRecord } from '../utils/bridge';

const router = Router();

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || `${fallback}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function enrichBridgeRecords(records: Awaited<ReturnType<typeof getLatestBridgeActivity>>): Promise<BridgeRecordWithChallenge[]> {
  const l2Hashes = records
    .map((record) => record.l2TxHash?.toLowerCase())
    .filter((hash): hash is string => Boolean(hash));
  const logsByTxHash = buildLogsByTxHash(await getLogsByTransactionHashes(l2Hashes));
  return records.map((record) => enrichBridgeRecord(record, logsByTxHash));
}

/**
 * GET /api/v1/bridge/latest?limit=20
 */
router.get('/latest', async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit as string | undefined, 20, 200);
    const cacheKey = `bridge:latest:${limit}`;
    const cached = await cacheService.get<BridgeRecordWithChallenge[]>(cacheKey);

    if (cached) {
      const response: APIResponse<BridgeRecordWithChallenge[]> = {
        success: true,
        data: cached,
        meta: { limit, total: cached.length },
      };
      return res.json(response);
    }

    const data = await enrichBridgeRecords(await getLatestBridgeActivity(limit));
    await cacheService.set(cacheKey, data, 10);

    const response: APIResponse<BridgeRecordWithChallenge[]> = {
      success: true,
      data,
      meta: { limit, total: data.length },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching latest bridge activity', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch bridge activity' });
  }
});

/**
 * GET /api/v1/bridge/l1-to-l2/latest?limit=20
 */
router.get('/l1-to-l2/latest', async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit as string | undefined, 20, 200);
    const cacheKey = `bridge:l1-to-l2:${limit}`;
    const cached = await cacheService.get<BridgeRecordWithChallenge[]>(cacheKey);

    if (cached) {
      return res.json({ success: true, data: cached, meta: { limit, total: cached.length } });
    }

    const data = await enrichBridgeRecords(await getLatestBridgeByDirection('l1_to_l2', limit));
    await cacheService.set(cacheKey, data, 10);

    const response: APIResponse<BridgeRecordWithChallenge[]> = {
      success: true,
      data,
      meta: { limit, total: data.length },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching l1->l2 bridge activity', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch l1->l2 bridge activity' });
  }
});

/**
 * GET /api/v1/bridge/l2-to-l1/latest?limit=20
 */
router.get('/l2-to-l1/latest', async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit as string | undefined, 20, 200);
    const cacheKey = `bridge:l2-to-l1:${limit}`;
    const cached = await cacheService.get<BridgeRecordWithChallenge[]>(cacheKey);

    if (cached) {
      return res.json({ success: true, data: cached, meta: { limit, total: cached.length } });
    }

    const data = await enrichBridgeRecords(await getLatestBridgeByDirection('l2_to_l1', limit));
    await cacheService.set(cacheKey, data, 10);

    const response: APIResponse<BridgeRecordWithChallenge[]> = {
      success: true,
      data,
      meta: { limit, total: data.length },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching l2->l1 bridge activity', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch l2->l1 bridge activity' });
  }
});

/**
 * GET /api/v1/bridge/:bridgeId
 */
router.get('/:bridgeId', async (req: Request, res: Response) => {
  try {
    const bridgeId = req.params.bridgeId.toLowerCase();
    const cacheKey = `bridge:id:${bridgeId}`;
    const cached = await cacheService.get<BridgeRecordWithChallenge>(cacheKey);

    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const data = await getBridgeById(bridgeId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Bridge record not found' });
    }

    const enriched = (await enrichBridgeRecords([data]))[0];
    await cacheService.set(cacheKey, enriched, 30);
    res.json({ success: true, data: enriched });
  } catch (error: any) {
    logger.error('Error fetching bridge record by id', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch bridge record' });
  }
});

export default router;
