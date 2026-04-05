import { ethers } from 'ethers';
import logger from '../utils/logger';

/**
 * Event Decoder Service
 * Decodes contract event logs into human-readable format
 */

// Common event signatures
const COMMON_EVENTS = {
  // ERC20
  Transfer: 'Transfer(address,address,uint256)',
  Approval: 'Approval(address,address,uint256)',
  
  // Bridge Events
  Deposited: 'Deposited(bytes32,address,address,address,uint256,uint256)',
  WithdrawalInitiated: 'WithdrawalInitiated(bytes32,address,address,address,uint256,uint256)',
  WithdrawalQueued: 'WithdrawalQueued(bytes32,address,address,uint256,uint256)',
  WithdrawalFinalized: 'WithdrawalFinalized(bytes32,address,uint256)',
};

export class EventDecoder {
  private iface: ethers.Interface;
  
  constructor() {
    // Create interface with common events
    const abi = Object.values(COMMON_EVENTS).map(sig => `event ${sig}`);
    this.iface = new ethers.Interface(abi);
  }
  
  decodeLog(topics: string[], data: string): any {
    try {
      const log = this.iface.parseLog({ topics, data });
      
      if (!log) return null;
      
      return {
        name: log.name,
        signature: log.signature,
        args: this.formatArgs(log.args),
      };
    } catch (error: any) {
      logger.debug('Failed to decode log', { error: error.message });
      return null;
    }
  }
  
  private formatArgs(args: any): any {
    const formatted: any = {};
    
    for (const key of Object.keys(args)) {
      if (isNaN(Number(key))) {
        const value = args[key];
        
        if (typeof value === 'bigint') {
          formatted[key] = value.toString();
        } else if (value && typeof value === 'object' && value._isBigNumber) {
          formatted[key] = value.toString();
        } else {
          formatted[key] = value;
        }
      }
    }
    
    return formatted;
  }
  
  getEventSignature(eventName: string): string | null {
    const sig = COMMON_EVENTS[eventName as keyof typeof COMMON_EVENTS];
    if (!sig) return null;
    return ethers.id(sig);
  }
  
  isKnownEvent(topic0: string): boolean {
    for (const sig of Object.values(COMMON_EVENTS)) {
      if (ethers.id(sig) === topic0) {
        return true;
      }
    }
    return false;
  }
}

export default new EventDecoder();