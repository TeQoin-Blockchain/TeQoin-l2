import { ethers } from 'ethers';

const WS_URL = process.env.TEQ_WSS_URL || 'wss://rpc.teqoin.io';
const BRIDGE_ADDRESS = process.env.TEQ_BRIDGE_ADDRESS || '';

// Optional comma-separated token list to reduce noise.
// Example: 0xToken1,0xToken2
const TOKEN_FILTER = (process.env.TEQ_TOKEN_FILTER || '')
  .split(',')
  .map((v) => v.trim())
  .filter((v) => v.length > 0)
  .map((v) => v.toLowerCase());

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

const ERC20_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const L2_BRIDGE_ABI = [
  'event DepositFinalized(address indexed l1Token, address indexed l2Token, address indexed to, uint256 amount, uint256 l1DepositNonce)',
  'event WithdrawalInitiated(address indexed l2Token, address indexed from, address indexed to, uint256 amount, uint256 nonce)',
];

const provider = new ethers.WebSocketProvider(WS_URL);
const erc20Iface = new ethers.Interface(ERC20_TRANSFER_ABI);
const bridgeIface = new ethers.Interface(L2_BRIDGE_ABI);

const tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();

async function getTokenMeta(address: string): Promise<{ symbol: string; decimals: number }> {
  const cached = tokenMetaCache.get(address.toLowerCase());
  if (cached) {
    return cached;
  }

  const contract = new ethers.Contract(address, ERC20_TRANSFER_ABI, provider);

  let symbol = 'UNKNOWN';
  let decimals = 18;

  try {
    symbol = await contract.symbol();
  } catch {
    // Non-ERC20 or token with non-standard symbol().
  }

  try {
    decimals = Number(await contract.decimals());
  } catch {
    // Non-ERC20 or token with non-standard decimals().
  }

  const meta = { symbol, decimals };
  tokenMetaCache.set(address.toLowerCase(), meta);
  return meta;
}

function short(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function start(): Promise<void> {
  console.log('------------------------------------------------------------');
  console.log(`TeQoin monitor started`);
  console.log(`WS: ${WS_URL}`);
  console.log(`Bridge: ${BRIDGE_ADDRESS || '(not set, bridge events disabled)'}`);
  console.log(`Token filter: ${TOKEN_FILTER.length > 0 ? TOKEN_FILTER.join(', ') : 'all tokens'}`);
  console.log('------------------------------------------------------------');

  const transferFilter: ethers.Filter = {
    topics: [TRANSFER_TOPIC],
  };

  provider.on(transferFilter, async (log) => {
    try {
      const token = log.address.toLowerCase();

      if (TOKEN_FILTER.length > 0 && !TOKEN_FILTER.includes(token)) {
        return;
      }

      const parsed = erc20Iface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) {
        return;
      }

      const from = String(parsed.args.from);
      const to = String(parsed.args.to);
      const value = parsed.args.value as bigint;
      const meta = await getTokenMeta(token);
      const formatted = ethers.formatUnits(value, meta.decimals);

      console.log(
        `[TRANSFER] block=${log.blockNumber} token=${short(token)} (${meta.symbol}) from=${short(from)} to=${short(to)} amount=${formatted} tx=${log.transactionHash}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TRANSFER][ERROR] ${message}`);
    }
  });

  if (BRIDGE_ADDRESS) {
    const bridge = new ethers.Contract(BRIDGE_ADDRESS, L2_BRIDGE_ABI, provider);

    bridge.on(
      'DepositFinalized',
      (
        l1Token: string,
        l2Token: string,
        to: string,
        amount: bigint,
        l1DepositNonce: bigint,
        event: ethers.EventLog
      ) => {
        console.log(
          `[BRIDGE IN] block=${event.blockNumber} l1Token=${l1Token} l2Token=${l2Token} to=${to} amount=${amount.toString()} nonce=${l1DepositNonce.toString()} tx=${event.transactionHash}`
        );
      }
    );

    bridge.on(
      'WithdrawalInitiated',
      (
        l2Token: string,
        from: string,
        to: string,
        amount: bigint,
        nonce: bigint,
        event: ethers.EventLog
      ) => {
        console.log(
          `[BRIDGE OUT] block=${event.blockNumber} l2Token=${l2Token} from=${from} to=${to} amount=${amount.toString()} nonce=${nonce.toString()} tx=${event.transactionHash}`
        );
      }
    );
  }

  const rawWs = (provider as any)._websocket;
  if (rawWs && typeof rawWs.on === 'function') {
    rawWs.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[WS][ERROR] ${message}`);
    });

    rawWs.on('close', (code: number, reason: Buffer | string) => {
      const reasonStr = Buffer.isBuffer(reason) ? reason.toString() : String(reason);
      console.error(`[WS][CLOSE] code=${code} reason=${reasonStr}`);
    });
  }
}

start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start monitor: ${message}`);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await provider.destroy();
  process.exit(0);
});
