const { ethers } = require('ethers');
require('dotenv').config();

async function test() {
  console.log('Testing batch submission manually...\n');

  // Setup
  const provider = new ethers.JsonRpcProvider(process.env.L1_RPC_URL);
  const wallet = new ethers.Wallet(process.env.SEQUENCER_PRIVATE_KEY, provider);

  console.log('Wallet:', wallet.address);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');

  if (balance === 0n) {
    console.log('\n❌ NO SEPOLIA ETH! This is the problem!');
    console.log('Get testnet ETH from:');
    console.log('  - https://sepoliafaucet.com/');
    console.log('  - https://www.infura.io/faucet/sepolia');
    return;
  }

  // Check L1 connection
  const blockNumber = await provider.getBlockNumber();
  console.log('L1 Block:', blockNumber);

  // Try to call contract
  const stateCommitment = new ethers.Contract(
    process.env.L1_STATE_COMMITMENT_ADDRESS,
    ['function currentBatchId() view returns (uint256)'],
    wallet
  );

  try {
    const batchId = await stateCommitment.currentBatchId();
    console.log('Current Batch ID:', batchId.toString());
    console.log('\n✅ Everything looks good!');
  } catch (error) {
    console.log('\n❌ Contract call failed:', error.message);
  }
}

test();
