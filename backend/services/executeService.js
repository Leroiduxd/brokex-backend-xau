const { ethers } = require('ethers');
const config = require('../config/config');
const coreAbi = require('../abi/coreAbi');

// Centralized rate-limited providers
const { readProviders: providers, writeProviders } = require('./providerService');

const wallets = {};
const coreContracts = {};

// 🧪 Testnet setups (bound to premium WRITE_RPC_URL by default)
if (config.testnet.PRIVATE_KEY && config.testnet.PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
  try {
    wallets.testnet = new ethers.Wallet(config.testnet.PRIVATE_KEY, writeProviders.testnet);
    const coreAddress = (config.testnet.CORE_ADDRESS || '').toLowerCase();
    coreContracts.testnet = new ethers.Contract(coreAddress, coreAbi, wallets.testnet);
    console.log(`[ExecuteService] [TESTNET] Premium Write Wallet initialized with provider: ${config.testnet.WRITE_RPC_URL ? 'ZAN Node' : 'Public Node'}`);
  } catch (err) {
    console.error(`[ExecuteService] [TESTNET] Failed to initialize premium write wallet: ${err.message}`);
  }
}

// 🚀 Mainnet setups (bound to premium WRITE_RPC_URL by default)
if (config.mainnet.PRIVATE_KEY && config.mainnet.RPC_URL && config.mainnet.PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
  try {
    wallets.mainnet = new ethers.Wallet(config.mainnet.PRIVATE_KEY, writeProviders.mainnet);
    const coreAddress = (config.mainnet.CORE_ADDRESS || '').toLowerCase();
    coreContracts.mainnet = new ethers.Contract(coreAddress, coreAbi, wallets.mainnet);
    console.log(`[ExecuteService] [MAINNET] Premium Write Wallet initialized with provider: ${config.mainnet.WRITE_RPC_URL ? 'Premium Node' : 'Public Node'}`);
  } catch (err) {
    console.error(`[ExecuteService] [MAINNET] Failed to initialize premium write wallet: ${err.message}`);
  }
}

/**
 * Parse logs to identify which trades successfully executed.
 */
function parseExecutedReceipt(receipt, network, tradeIds) {
  const executedIds = [];
  const skippedIds = [];

  const iface = new ethers.Interface(coreAbi);
  const tradeEventTopic = iface.getEvent('TradeEvent').topicHash;
  const emittedTradeIds = new Set();
  const targetCoreAddress = (config[network].CORE_ADDRESS || '').toLowerCase();
  
  receipt.logs.forEach(log => {
    if (log.address.toLowerCase() === targetCoreAddress && log.topics[0] === tradeEventTopic) {
      try {
        const parsed = iface.parseLog(log);
        const tId = Number(parsed.args.tradeId.toString());
        emittedTradeIds.add(tId);
      } catch (e) {
        // ignore parsing error
      }
    }
  });

  tradeIds.forEach(id => {
    const idNum = Number(id);
    if (emittedTradeIds.has(idNum)) {
      executedIds.push(idNum);
    } else {
      skippedIds.push(idNum);
    }
  });

  return { executedIds, skippedIds };
}

/**
 * Execute a batch of trades on the BrokexCore smart contract.
 * Logs and filters actual results from TradeEvents.
 * Supports signature: batchExecute(network, tradeIds, reasons, supraProof, kmsProof)
 * Or legacy: batchExecute(tradeIds, reasons, supraProof, kmsProof) [defaults to testnet]
 * 
 * @param {string|number[]} networkOrTradeIds
 * @param {number[]|string[]} tradeIdsOrReasons
 * @param {number[]|string} reasonsOrSupraProof
 * @param {string|Object} [supraProofOrKmsProof]
 * @param {Object} [kmsProof]
 * @returns {Promise<Object>} Object containing tx hash, executed IDs and skipped IDs
 */
async function batchExecute(networkOrTradeIds, tradeIdsOrReasons, reasonsOrSupraProof, supraProofOrKmsProof, kmsProof) {
  let network = 'testnet';
  let tradeIds = networkOrTradeIds;
  let reasons = tradeIdsOrReasons;
  let supraProof = reasonsOrSupraProof;
  let actualKmsProof = supraProofOrKmsProof;

  if (networkOrTradeIds === 'testnet' || networkOrTradeIds === 'mainnet') {
    network = networkOrTradeIds;
    tradeIds = tradeIdsOrReasons;
    reasons = reasonsOrSupraProof;
    supraProof = supraProofOrKmsProof;
    actualKmsProof = kmsProof;
  }

  const wallet = wallets[network];
  const coreContract = coreContracts[network];

  if (!wallet || !coreContract) {
    throw new Error(`[ExecuteService] [${network.toUpperCase()}] Wallet or contract not initialized. Please verify PRIVATE_KEY and RPC_URL in .env.`);
  }

  if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
    return { hash: null, executedIds: [], skippedIds: [] };
  }

  console.log(`[ExecuteService] [${network.toUpperCase()}] Initiating batchExecute for trades: [${tradeIds.join(', ')}]...`);

  // Construct riskProofs array matching the length of tradeIds
  const riskProofs = tradeIds.map(() => ({
    supraId: BigInt(actualKmsProof.supraId || 0),
    maxOILong: BigInt(actualKmsProof.maxOILong),
    maxOIShort: BigInt(actualKmsProof.maxOIShort),
    spreadLong: BigInt(actualKmsProof.spreadLong),
    spreadShort: BigInt(actualKmsProof.spreadShort),
    timestamp: BigInt(actualKmsProof.timestamp),
    sig: actualKmsProof.sig
  }));

  let tx;
  let tryFallback = false;

  try {
    console.log(`[ExecuteService] [${network.toUpperCase()}] Sending batchExecute via primary write RPC...`);
    tx = await coreContract.batchExecute(
      supraProof,
      tradeIds.map(id => BigInt(id)),
      reasons.map(r => Number(r)),
      riskProofs
    );
  } catch (error) {
    console.warn(`[ExecuteService] [${network.toUpperCase()}] ⚠️ Primary write RPC failed: ${error.message}`);
    tryFallback = true;
  }

  // Fallback routine if primary write RPC fails
  if (tryFallback) {
    const fallbackProvider = providers[network];
    const writeProvider = writeProviders[network];
    
    if (fallbackProvider && fallbackProvider !== writeProvider) {
      try {
        console.log(`[ExecuteService] [${network.toUpperCase()}] 🔄 Attempting fallback execution using public RPC: ${config[network].RPC_URL}...`);
        const fallbackWallet = new ethers.Wallet(config[network].PRIVATE_KEY, fallbackProvider);
        const fallbackContract = new ethers.Contract(coreContract.target, coreAbi, fallbackWallet);
        
        tx = await fallbackContract.batchExecute(
          supraProof,
          tradeIds.map(id => BigInt(id)),
          reasons.map(r => Number(r)),
          riskProofs
        );
      } catch (fallbackError) {
        console.error(`[ExecuteService] [${network.toUpperCase()}] ❌ Fallback execution also failed:`, fallbackError.message);
        throw fallbackError;
      }
    } else {
      throw new Error(`Primary execution failed and no separate fallback provider is configured.`);
    }
  }

  // Await and process receipt
  try {
    console.log(`[ExecuteService] [${network.toUpperCase()}] Transaction sent: ${tx.hash}. Waiting for confirmation...`);
    const receipt = await tx.wait();
    console.log(`[ExecuteService] [${network.toUpperCase()}] Transaction confirmed in block ${receipt.blockNumber}`);

    const { executedIds, skippedIds } = parseExecutedReceipt(receipt, network, tradeIds);
    console.log(`[ExecuteService] [${network.toUpperCase()}] Batch results: Executed: [${executedIds.join(', ')}], Skipped/Failed: [${skippedIds.join(', ')}]`);

    return {
      hash: receipt.hash,
      executedIds,
      skippedIds
    };
  } catch (receiptError) {
    console.error(`[ExecuteService] [${network.toUpperCase()}] Error waiting for transaction receipt:`, receiptError);
    throw receiptError;
  }
}

module.exports = {
  batchExecute,
  getContract: (network = 'testnet') => coreContracts[network],
  getProvider: (network = 'testnet') => providers[network]
};
