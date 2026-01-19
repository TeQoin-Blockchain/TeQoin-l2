import { Config, ServiceStatus, ServiceState, SequencerStats } from '../types';
import { logger, logService } from '../utils/logger';
import { getStats } from '../database/models';
import { L1ListenerService } from './l1-listener.service';
import { L2ProcessorService } from './l2-processor.service';
import { L2WithdrawalListenerService } from './l2-withdrawal-listener.service';
import { BatchSubmitterService } from './batch-submitter.service';
import BlockBuilderService from './block-builder.service';


// ═══════════════════════════════════════════════════════
// SEQUENCER MANAGER SERVICE
// Purpose: Orchestrate all services
// ═══════════════════════════════════════════════════════

export class SequencerManagerService {
  private blockBuilder: BlockBuilderService;
  private l1Listener: L1ListenerService;
  private l2Processor: L2ProcessorService;
  private l2WithdrawalListener: L2WithdrawalListenerService;
  private batchSubmitter: BatchSubmitterService;
  
  private serviceStatus: ServiceStatus = {
    l1Listener: ServiceState.STOPPED,
    l2Processor: ServiceState.STOPPED,
    l2WithdrawalListener: ServiceState.STOPPED,
    batchSubmitter: ServiceState.STOPPED,
  };
  
  private startTime: Date = new Date();
  
  constructor(private config: Config) {
    this.blockBuilder = new BlockBuilderService(config);
    this.l1Listener = new L1ListenerService(config);
    this.l2Processor = new L2ProcessorService(config);
    this.l2WithdrawalListener = new L2WithdrawalListenerService(config);
    this.batchSubmitter = new BatchSubmitterService(config);
  }
  
  /**
   * Start all services
   */
  async startAll(): Promise<void> {
    logService('SEQUENCER-MANAGER', '═══════════════════════════════════════');
    logService('SEQUENCER-MANAGER', '🚀 STARTING SEQUENCER SERVICE');
    logService('SEQUENCER-MANAGER', '═══════════════════════════════════════');
    
    try {
      // Start Block Builder
      logService('SEQUENCER-MANAGER', 'Starting Block Builder...');
      await this.blockBuilder.start();
      // Start L1 Listener
      logService('SEQUENCER-MANAGER', 'Starting L1 Listener...');
      this.serviceStatus.l1Listener = ServiceState.STARTING;
      await this.l1Listener.start();
      this.serviceStatus.l1Listener = ServiceState.RUNNING;
      
      // Start L2 Processor
      logService('SEQUENCER-MANAGER', 'Starting L2 Processor...');
      this.serviceStatus.l2Processor = ServiceState.STARTING;
      await this.l2Processor.start();
      this.serviceStatus.l2Processor = ServiceState.RUNNING;
      
      // Start L2 Withdrawal Listener
      logService('SEQUENCER-MANAGER', 'Starting L2 Withdrawal Listener...');
      this.serviceStatus.l2WithdrawalListener = ServiceState.STARTING;
      await this.l2WithdrawalListener.start();
      this.serviceStatus.l2WithdrawalListener = ServiceState.RUNNING;
      
      // Start Batch Submitter
      logService('SEQUENCER-MANAGER', 'Starting Batch Submitter...');
      this.serviceStatus.batchSubmitter = ServiceState.STARTING;
      await this.batchSubmitter.start();
      this.serviceStatus.batchSubmitter = ServiceState.RUNNING;
      
      logService('SEQUENCER-MANAGER', '═══════════════════════════════════════');
      logService('SEQUENCER-MANAGER', '✅ ALL SERVICES STARTED SUCCESSFULLY');
      logService('SEQUENCER-MANAGER', '═══════════════════════════════════════');
      
      this.startHealthCheckMonitor();
      
    } catch (error) {
      logService('SEQUENCER-MANAGER', 'Failed to start services', { error });
      this.updateErrorStates();
      throw error;
    }
  }
  
  /**
   * Stop all services
   */
  async stopAll(): Promise<void> {
    logService('SEQUENCER-MANAGER', '═══════════════════════════════════════');
    logService('SEQUENCER-MANAGER', '🛑 STOPPING SEQUENCER SERVICE');
    logService('SEQUENCER-MANAGER', '═══════════════════════════════════════');
    
    try {
      // Stop Block Builder first
      logService('SEQUENCER-MANAGER', 'Stopping Block Builder...');
      await this.blockBuilder.stop();
      // Stop Batch Submitter first
      logService('SEQUENCER-MANAGER', 'Stopping Batch Submitter...');
      this.serviceStatus.batchSubmitter = ServiceState.STOPPING;
      await this.batchSubmitter.stop();
      this.serviceStatus.batchSubmitter = ServiceState.STOPPED;
      
      // Stop L2 Withdrawal Listener
      logService('SEQUENCER-MANAGER', 'Stopping L2 Withdrawal Listener...');
      this.serviceStatus.l2WithdrawalListener = ServiceState.STOPPING;
      await this.l2WithdrawalListener.stop();
      this.serviceStatus.l2WithdrawalListener = ServiceState.STOPPED;
      
      // Stop L2 Processor
      logService('SEQUENCER-MANAGER', 'Stopping L2 Processor...');
      this.serviceStatus.l2Processor = ServiceState.STOPPING;
      await this.l2Processor.stop();
      this.serviceStatus.l2Processor = ServiceState.STOPPED;
      
      // Stop L1 Listener last
      logService('SEQUENCER-MANAGER', 'Stopping L1 Listener...');
      this.serviceStatus.l1Listener = ServiceState.STOPPING;
      await this.l1Listener.stop();
      this.serviceStatus.l1Listener = ServiceState.STOPPED;
      
      logService('SEQUENCER-MANAGER', '═══════════════════════════════════════');
      logService('SEQUENCER-MANAGER', '✅ ALL SERVICES STOPPED');
      logService('SEQUENCER-MANAGER', '═══════════════════════════════════════');
      
    } catch (error) {
      logService('SEQUENCER-MANAGER', 'Error while stopping services', { error });
      throw error;
    }
  }
  
  /**
   * Get service status
   */
  getServiceStatus(): ServiceStatus {
    return { ...this.serviceStatus };
  }
  
  /**
   * Get statistics
   */
  async getStats(): Promise<SequencerStats> {
    return await getStats();
  }
  
  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }
  
  /**
   * Check overall health
   */
  isHealthy(): boolean {
    return (
      this.serviceStatus.l1Listener === ServiceState.RUNNING &&
      this.serviceStatus.l2Processor === ServiceState.RUNNING &&
      this.serviceStatus.l2WithdrawalListener === ServiceState.RUNNING &&
      this.serviceStatus.batchSubmitter === ServiceState.RUNNING
    );
  }
  
  /**
   * Update all service states to ERROR
   */
  private updateErrorStates(): void {
    if (!this.l1Listener.isActive()) {
      this.serviceStatus.l1Listener = ServiceState.ERROR;
    }
    if (!this.l2Processor.isActive()) {
      this.serviceStatus.l2Processor = ServiceState.ERROR;
    }
    if (!this.l2WithdrawalListener.isActive()) {
      this.serviceStatus.l2WithdrawalListener = ServiceState.ERROR;
    }
    if (!this.batchSubmitter.isActive()) {
      this.serviceStatus.batchSubmitter = ServiceState.ERROR;
    }
  }
  
  /**
   * Start health check monitor (every minute)
   */
  private startHealthCheckMonitor(): void {
    setInterval(() => {
      if (!this.isHealthy()) {
        logger.warn('Some services are not healthy', {
          status: this.serviceStatus,
        });
      } else {
        logService('SEQUENCER-MANAGER', 'Health check: All services running');
      }
    }, 60000); // Every minute
  }
}

export default SequencerManagerService;