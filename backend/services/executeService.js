const { ethers } = require('ethers');
const config = require('../config/config');
const coreAbi = require('../abi/coreAbi');

// Initialize provider maps
const providers = {
  testnet: new ethers.JsonRpcProvider(config.testnet.RPC_URL),
  mainnet: config.mainnet.RPC_URL ? new ethers.JsonRpcProvider(config.mainnet.RPC_URL) : null
};

const wallets = {};
const coreContracts = {};

// 🧪 Testnet setups
if (config.testnet.PRIVATE_KEY && config.testnet.PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
  try {
    wallets.testnet = new ethers.Wallet(config.testnet.PRIVATE_KEY, providers.testnet);
    const coreAddress = (config.testnet.CORE_ADDRESS || '').toLowerCase();
    coreContracts.testnet = new ethers.Contract(coreAddress, coreAbi, wallets.testnet);
    console.log(`[ExecuteService] [TESTNET] Ethers Wallet Signer initialized with address: ${wallets.testnet.address}`);
  } catch (err) {
    console.error(`[ExecuteService] [TESTNET] Failed to initialize wallet: ${err.message}`);
  }
}

// 🚀 Mainnet setups
if (config.mainnet.PRIVATE_KEY && config.mainnet.RPC_URL && config.mainnet.PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
  try {
    wallets.mainnet = new ethers.Wallet(config.mainnet.PRIVATE_KEY, providers.mainnet);
    const coreAddress = (config.mainnet.CORE_ADDRESS || '').toLowerCase();
    coreContracts.mainnet = new ethers.Contract(coreAddress, coreAbi, wallets.mainnet);
    console.log(`[ExecuteService] [MAINNET] Ethers Wallet Signer initialized with address: ${wallets.mainnet.address}`);
  } catch (err) {
    console.error(`[ExecuteService] [MAINNET] Failed to initialize wallet: ${err.message}`);
  }
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
    maxOILong: BigInt(actualKmsProof.maxOILong),
    maxOIShort: BigInt(actualKmsProof.maxOIShort),
    alphaLock: BigInt(actualKmsProof.alphaLock),
    spreadLong: BigInt(actualKmsProof.spreadLong),
    spreadShort: BigInt(actualKmsProof.spreadShort),
    expiry: BigInt(actualKmsProof.expiry),
    sig: actualKmsProof.signature
  }));

  try {
    // Send transaction
    const tx = await coreContract.batchExecute(
      supraProof,
      tradeIds.map(id => BigInt(id)),
      reasons.map(r => Number(r)),
      riskProofs
    );

    console.log(`[ExecuteService] [${network.toUpperCase()}] Transaction sent: ${tx.hash}. Waiting for confirmation...`);
    const receipt = await tx.wait();
    console.log(`[ExecuteService] [${network.toUpperCase()}] Transaction confirmed in block ${receipt.blockNumber}`);

    const executedIds = [];
    const skippedIds = [];

    // Parse logs to identify which trades successfully executed
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

    // Check which requested trade IDs were in the successfully executed set
    tradeIds.forEach(id => {
      const idNum = Number(id);
      if (emittedTradeIds.has(idNum)) {
        executedIds.push(idNum);
      } else {
        skippedIds.push(idNum);
      }
    });

    console.log(`[ExecuteService] [${network.toUpperCase()}] Batch results: Executed: [${executedIds.join(', ')}], Skipped/Failed: [${skippedIds.join(', ')}]`);

    return {
      hash: receipt.hash,
      executedIds,
      skippedIds
    };
  } catch (error) {
    console.error(`[ExecuteService] [${network.toUpperCase()}] Error executing batch on-chain:`, error);
    throw error;
  }
}

module.exports = {
  batchExecute,
  getContract: (network = 'testnet') => coreContracts[network],
  getProvider: (network = 'testnet') => providers[network]
};
