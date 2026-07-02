const { ethers } = require('ethers');
require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const rpcUrl = requireEnv('L1_RPC_URL');
  const sequencerPrivateKey = requireEnv('SEQUENCER_PRIVATE_KEY');
  const stateCommitmentAddress = requireEnv('L1_STATE_COMMITMENT_ADDRESS');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(sequencerPrivateKey, provider);

  const [balance, blockNumber] = await Promise.all([
    provider.getBalance(wallet.address),
    provider.getBlockNumber(),
  ]);

  const stateCommitment = new ethers.Contract(
    stateCommitmentAddress,
    ['function currentBatchId() view returns (uint256)'],
    wallet
  );
  const currentBatchId = await stateCommitment.currentBatchId();

  console.log(JSON.stringify({
    status: 'ok',
    signerAddress: wallet.address,
    signerBalanceEth: ethers.formatEther(balance),
    l1BlockNumber: blockNumber,
    currentBatchId: currentBatchId.toString(),
  }, null, 2));

  if (balance === 0n) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: 'error',
    message: error.message,
  }, null, 2));
  process.exit(1);
});
