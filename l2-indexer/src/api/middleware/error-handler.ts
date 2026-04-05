import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';
import { APIResponse } from '../../types';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error('API Error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });
  
  const response: APIResponse<null> = {
    success: false,
    error: err.message || 'Internal server error',
  };
  
  res.status(500).json(response);
};

export const notFoundHandler = (req: Request, res: Response) => {
  const response: APIResponse<null> = {
    success: false,
    error: 'Endpoint not found',
  };
  
  res.status(404).json(response);
};