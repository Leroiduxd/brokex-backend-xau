const { ethers } = require('ethers');
const config = require('../config/config');
const coreAbi = require('../abi/coreAbi');

// Initialize provider and signer
const provider = new ethers.JsonRpcProvider(config.RPC_URL);
let wallet;
let coreContract;

if (config.PRIVATE_KEY && config.PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
  try {
    wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
    const coreAddress = (config.CORE_ADDRESS || '').toLowerCase();
    coreContract = new ethers.Contract(coreAddress, coreAbi, wallet);
    console.log(`[ExecuteService] Ethers Wallet Signer initialized with address: ${wallet.address}`);
  } catch (err) {
    console.error(`[ExecuteService] Failed to initialize wallet: ${err.message}`);
  }
} else {
  console.warn(`[ExecuteService] WARNING: PRIVATE_KEY is not set or is still a placeholder. batchExecute transactions will fail.`);
}

/**
 * Execute a batch of trades on the BrokexCore smart contract.
 * Logs and filters actual results from TradeEvents.
 * 
 * @param {number[]|string[]} tradeIds Array of trade IDs to execute
 * @param {number[]} reasons Array of reasons corresponding to tradeIds (1=SL, 2=TP, 3=LIQ, 0=LIMIT/STOP)
 * @param {string} supraProof The Supra Oracle pull proof (hex string starting with '0x')
 * @param {Object} kmsProof The KMS proof object fetched from kmsProofService
 * @returns {Promise<Object>} Object containing tx hash, executed IDs and skipped IDs
 */
async function batchExecute(tradeIds, reasons, supraProof, kmsProof) {
  if (!wallet || !coreContract) {
    throw new Error('[ExecuteService] Wallet not initialized. Please verify PRIVATE_KEY and RPC_URL in .env.');
  }

  if (tradeIds.length === 0) {
    return { hash: null, executedIds: [], skippedIds: [] };
  }

  console.log(`[ExecuteService] Initiating batchExecute for trades: [${tradeIds.join(', ')}]...`);

  // Construct riskProofs array matching the length of tradeIds
  const riskProofs = tradeIds.map(() => ({
    maxOILong: BigInt(kmsProof.maxOILong),
    maxOIShort: BigInt(kmsProof.maxOIShort),
    alphaLock: BigInt(kmsProof.alphaLock),
    spreadLong: BigInt(kmsProof.spreadLong),
    spreadShort: BigInt(kmsProof.spreadShort),
    expiry: BigInt(kmsProof.expiry),
    sig: kmsProof.signature
  }));

  try {
    // Send transaction
    const tx = await coreContract.batchExecute(
      supraProof,
      tradeIds.map(id => BigInt(id)),
      reasons.map(r => Number(r)),
      riskProofs
    );

    console.log(`[ExecuteService] Transaction sent: ${tx.hash}. Waiting for confirmation...`);
    const receipt = await tx.wait();
    console.log(`[ExecuteService] Transaction confirmed in block ${receipt.blockNumber}`);

    const executedIds = [];
    const skippedIds = [];

    // Parse logs to identify which trades successfully executed
    const iface = new ethers.Interface(coreAbi);
    const tradeEventTopic = iface.getEvent('TradeEvent').topicHash;

    const emittedTradeIds = new Set();
    receipt.logs.forEach(log => {
      if (log.address.toLowerCase() === config.CORE_ADDRESS.toLowerCase() && log.topics[0] === tradeEventTopic) {
        try {
          const parsed = iface.parseLog(log);
          const tId = Number(parsed.args.tradeId.toString());
          emittedTradeIds.add(tId);
        } catch (e) {
          // ignore parsing error
        }
      }
    });

    // Check which requested trade IDs were in the successfully executed set
    tradeIds.forEach(id => {
      const idNum = Number(id);
      if (emittedTradeIds.has(idNum)) {
        executedIds.push(idNum);
      } else {
        skippedIds.push(idNum);
      }
    });

    console.log(`[ExecuteService] Batch results: Executed: [${executedIds.join(', ')}], Skipped/Failed: [${skippedIds.join(', ')}]`);

    return {
      hash: receipt.hash,
      executedIds,
      skippedIds
    };
  } catch (error) {
    console.error('[ExecuteService] Error executing batch on-chain:', error);
    throw error;
  }
}

module.exports = {
  batchExecute,
  getContract: () => coreContract,
  getProvider: () => provider
};
