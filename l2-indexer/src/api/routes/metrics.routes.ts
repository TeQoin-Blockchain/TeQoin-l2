import { Router, Request, Response } from 'express';
import { getGasMetrics, getTPS } from '../../database/queries/transactions';
import { APIResponse, GasMetrics, TPSMetric } from '../../types';
import cacheService from '../../services/cache.service';
import logger from '../../utils/logger';

const router = Router();

function parseWindow(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || `${fallback}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/**
 * GET /api/v1/metrics/tps?window=60
 */
router.get('/tps', async (req: Request, res: Response) => {
  try {
    const windowSeconds = parseWindow(req.query.window as string | undefined, 60, 86400);
    const cacheKey = `metrics:tps:${windowSeconds}`;

    const cached = await cacheService.get<TPSMetric>(cacheKey);
    if (cached) {
      const response: APIResponse<TPSMetric> = {
        success: true,
        data: cached,
      };
      return res.json(response);
    }

    const metric = await getTPS(windowSeconds);
    await cacheService.set(cacheKey, metric, 10);

    const response: APIResponse<TPSMetric> = {
      success: true,
      data: metric,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching TPS metric', { error: error.message });
    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch TPS metric',
    };
    res.status(500).json(response);
  }
});

/**
 * GET /api/v1/metrics/gas?window=300
 */
router.get('/gas', async (req: Request, res: Response) => {
  try {
    const windowSeconds = parseWindow(req.query.window as string | undefined, 300, 86400);
    const cacheKey = `metrics:gas:${windowSeconds}`;

    const cached = await cacheService.get<GasMetrics>(cacheKey);
    if (cached) {
      const response: APIResponse<GasMetrics> = {
        success: true,
        data: cached,
      };
      return res.json(response);
    }

    const metric = await getGasMetrics(windowSeconds);
    await cacheService.set(cacheKey, metric, 10);

    const response: APIResponse<GasMetrics> = {
      success: true,
      data: metric,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching gas metrics', { error: error.message });
    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch gas metrics',
    };
    res.status(500).json(response);
  }
});

/**
 * GET /api/v1/metrics/dashboard?window=300
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const windowSeconds = parseWindow(req.query.window as string | undefined, 300, 86400);
    const cacheKey = `metrics:dashboard:${windowSeconds}`;

    const cached = await cacheService.get<{ tps: TPSMetric; gas: GasMetrics }>(cacheKey);
    if (cached) {
      const response: APIResponse<{ tps: TPSMetric; gas: GasMetrics }> = {
        success: true,
        data: cached,
      };
      return res.json(response);
    }

    const [tps, gas] = await Promise.all([getTPS(windowSeconds), getGasMetrics(windowSeconds)]);
    const payload = { tps, gas };

    await cacheService.set(cacheKey, payload, 10);

    const response: APIResponse<{ tps: TPSMetric; gas: GasMetrics }> = {
      success: true,
      data: payload,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching dashboard metrics', { error: error.message });
    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch dashboard metrics',
    };
    res.status(500).json(response);
  }
});

export default router;
