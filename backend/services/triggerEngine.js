const axios = require('axios');
const dbService = require('./dbService');
const supraProofService = require('./supraProofService');
const kmsProofService = require('./kmsProofService');
const executeService = require('./executeService');
const config = require('../config/config');

// Separate locks and tracking for testnet and mainnet to prevent overlaps or blockades
const isExecuting = { testnet: false, mainnet: false };
const sentTradeIds = { testnet: new Set(), mainnet: new Set() };

/**
 * Check if the given network is fully configured in .env.
 */
function isNetworkConfigured(network) {
  if (network === 'testnet') return true;
  return !!(config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS && config.mainnet.CORE_ADDRESS);
}

/**
 * Iterates through active trades in LowDB and determines which are executable.
 * Supports signature: getExecutableTrades(network, oraclePrice)
 * @param {string} network 'testnet' | 'mainnet'
 * @param {BigInt} oraclePrice
 */
function getExecutableTrades(network, oraclePrice) {
  const trades = dbService.getTrades(network);
  const executable = [];

  for (const id in trades) {
    const t = trades[id];
    const state = Number(t.state);
    const direction = Number(t.direction);

    // Skip if this trade is already marked in-flight for this network
    if (sentTradeIds[network].has(Number(t.id))) continue;

    if (state === 0) { // STATE_ORDER
      const orderType = Number(t.orderType);
      const targetPrice = BigInt(t.targetPrice);

      if (orderType === 1) { // ORDER_LIMIT
        const ok = (direction === 1) ? (oraclePrice <= targetPrice) : (oraclePrice >= targetPrice);
        if (ok) executable.push({ id: Number(t.id), reason: 0 });
      } else if (orderType === 2) { // ORDER_STOP
        const ok = (direction === 1) ? (oraclePrice >= targetPrice) : (oraclePrice <= targetPrice);
        if (ok) executable.push({ id: Number(t.id), reason: 0 });
      }
    } else if (state === 1) { // STATE_OPEN
      const liqPrice = BigInt(t.liqPrice);
      const stopLoss = BigInt(t.stopLoss);
      const takeProfit = BigInt(t.takeProfit);

      // 1. Check Liquidation
      const isLiq = (direction === 1) ? (oraclePrice <= liqPrice) : (oraclePrice >= liqPrice);
      if (isLiq) {
        executable.push({ id: Number(t.id), reason: 3 });
        continue;
      }

      // 2. Check Stop Loss
      if (stopLoss > 0n) {
        const isSL = (direction === 1) ? (oraclePrice <= stopLoss) : (oraclePrice >= stopLoss);
        if (isSL) {
          executable.push({ id: Number(t.id), reason: 1 });
          continue;
        }
      }

      // 3. Check Take Profit
      if (takeProfit > 0n) {
        const isTP = (direction === 1) ? (oraclePrice >= takeProfit) : (oraclePrice <= takeProfit);
        if (isTP) {
          executable.push({ id: Number(t.id), reason: 2 });
          continue;
        }
      }
    }
  }

  return executable;
}

/**
 * Handle new real-time price feed events for a given network.
 * Evaluates execution triggers and batches them immediately.
 * Supports signature: handlePriceUpdate(network, rawPrice)
 * 
 * @param {string} network 'testnet' | 'mainnet'
 * @param {number} rawPrice E.g. 2350.45
 */
async function handlePriceUpdate(network = 'testnet', rawPrice) {
  if (!isNetworkConfigured(network)) return;
  if (isExecuting[network]) return; // Prevent overlapping execution threads on this network

  // Scale price to 6 decimals (precision of Brokex)
  const normalizedPrice = BigInt(Math.round(rawPrice * 1e6));

  // 1. Check if any trade is executable at this price
  const executable = getExecutableTrades(network, normalizedPrice);
  if (executable.length === 0) return;

  isExecuting[network] = true;

  // Mark these trades as in-flight
  executable.forEach(item => sentTradeIds[network].add(item.id));

  const tradeIds = executable.map(item => item.id);
  const reasons = executable.map(item => item.reason);

  console.log(`\n[TriggerEngine] [${network.toUpperCase()}] ⚡ REAL-TIME TRIGGER DETECTED! Price: ${rawPrice} ($${(Number(normalizedPrice) / 1e6).toFixed(2)})`);
  console.log(`[TriggerEngine] [${network.toUpperCase()}] Grouping ${tradeIds.length} executable trades into a single batch: [${tradeIds.join(', ')}]`);

  try {
    // 2. Fetch proofs in parallel
    console.log(`[TriggerEngine] [${network.toUpperCase()}] Fetching current Supra and KMS proofs...`);
    const [supraProof, kmsProof] = await Promise.all([
      supraProofService.getSupraProof([5500], network), // 5500 is XAU/USD
      kmsProofService.getKmsProof(network)
    ]);

    // 3. Send batch execution to the blockchain
    console.log(`[TriggerEngine] [${network.toUpperCase()}] Submitting batch execution to BrokexCore contract...`);
    const result = await executeService.batchExecute(network, tradeIds, reasons, supraProof, kmsProof);

    console.log(`[TriggerEngine] [${network.toUpperCase()}] Batch transaction completed successfully! Hash: ${result.hash}`);
  } catch (error) {
    console.error(`[TriggerEngine] [${network.toUpperCase()}] Failed to execute batch in real time:`, error.message);
  } finally {
    // Release execution lock
    isExecuting[network] = false;

    // Clear sent trade IDs after a 10s cooldown to allow them to be re-evaluated if they somehow failed
    setTimeout(() => {
      executable.forEach(item => sentTradeIds[network].delete(item.id));
    }, 10000);
  }
}

/**
 * Starts automated real-time price feed engine for XAU/USD (unified from wsBridge).
 */
function startTriggerEngine() {
  console.log(`[TriggerEngine] Unifying price feed: Listening to wsBridge real-time price updates for xau_usd...`);
  
  const wsBridge = require('./wsBridge');
  wsBridge.priceEmitter.on('price', async (price) => {
    try {
      // Evaluate testnet
      await handlePriceUpdate('testnet', price);
      
      // Evaluate mainnet if configured
      if (isNetworkConfigured('mainnet')) {
        await handlePriceUpdate('mainnet', price);
      }
    } catch (err) {
      console.error('[TriggerEngine] WS Price trigger evaluation failed:', err.message);
    }
  });
}

module.exports = {
  startTriggerEngine,
  handlePriceUpdate
};
