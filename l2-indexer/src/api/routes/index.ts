import { Router } from 'express';
import addressRoutes from './address.routes';
import transactionRoutes from './transaction.routes';
import blockRoutes from './block.routes';
import statsRoutes from './stats.routes';
import metricsRoutes from './metrics.routes';
import bridgeRoutes from './bridge.routes';

const router = Router();

// Mount routes
router.use('/address', addressRoutes);
router.use('/transaction', transactionRoutes);
router.use('/block', blockRoutes);
router.use('/stats', statsRoutes);
router.use('/metrics', metricsRoutes);
router.use('/bridge', bridgeRoutes);

export default router;
