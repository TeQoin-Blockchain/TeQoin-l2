import express, { Express } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { corsMiddleware } from './middleware/cors';
import { apiLimiter } from './middleware/rate-limit';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import routes from './routes';
import config from '../config';
import logger from '../utils/logger';

export class APIServer {
  private app: Express;
  private server: any;
  
  constructor() {
    this.app = express();
    // Ensure bigint fields from indexed data are JSON-safe in API responses.
    this.app.set('json replacer', (_key: string, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandlers();
  }
  
  private setupMiddleware(): void {
    // Security
    this.app.use(helmet());
    
    // CORS
    this.app.use(corsMiddleware);
    
    // Compression
    this.app.use(compression());
    
    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Rate limiting
    this.app.use('/api/', apiLimiter);
    
    // Request logging
    this.app.use((req, res, next) => {
      logger.debug('API Request', {
        method: req.method,
        path: req.path,
        ip: req.ip,
      });
      next();
    });
  }
  
  private setupRoutes(): void {
    // Health check (no rate limit)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    });
    
    // API v1 routes
    this.app.use('/api/v1', routes);
    
    // Root redirect
    this.app.get('/', (req, res) => {
      res.json({
        name: 'TeQoin L2 Indexer API',
        version: '1.0.0',
        endpoints: {
          health: '/health',
          stats: '/api/v1/stats',
          metrics: '/api/v1/metrics/dashboard',
          address: '/api/v1/address/:address/transactions',
          latestTransactions: '/api/v1/transaction/latest',
          transaction: '/api/v1/transaction/:hash',
          latestBlocks: '/api/v1/block/recent',
          bridgeLatest: '/api/v1/bridge/latest',
          bridgeById: '/api/v1/bridge/:bridgeId',
          addressBridgeHistory: '/api/v1/address/:address/bridge-history',
          block: '/api/v1/block/:numberOrHash',
        },
      });
    });
  }
  
  private setupErrorHandlers(): void {
    // 404 handler
    this.app.use(notFoundHandler);
    
    // Error handler
    this.app.use(errorHandler);
  }
  
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(config.api.port, config.api.host, () => {
          logger.info('API Server started', {
            host: config.api.host,
            port: config.api.port,
            url: `http://${config.api.host}:${config.api.port}`,
          });
          resolve();
        });
        
        this.server.on('error', (error: Error) => {
          logger.error('API Server error', { error: error.message });
          reject(error);
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('API Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  
  getApp(): Express {
    return this.app;
  }
}