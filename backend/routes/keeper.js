const express = require('express');
const router = express.Router();
const dbService = require('../services/dbService');
const supraProofService = require('../services/supraProofService');
const kmsProofService = require('../services/kmsProofService');
const executeService = require('../services/executeService');
const config = require('../config/config');
const { ethers } = require('ethers');

/**
 * Normalizes Supra Oracle price to 6 decimals (Precision of Brokex)
 */
function normalizePrice(price, decimals) {
  const p = BigInt(price.toString());
  const d = Number(decimals);
  if (d === 6) return p;
  if (d > 6) return p / (10n ** BigInt(d - 6));
  return p * (10n ** BigInt(6 - d));
}

/**
 * Check if the given network is fully configured in .env.
 */
function isNetworkConfigured(network) {
  if (network === 'testnet') return true;
  return !!(config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS && config.mainnet.CORE_ADDRESS);
}

/**
 * Iterates through active trades in LowDB and determines which are executable
 * under the provided raw oracle price.
 * 
 * @param {string} network 'testnet' | 'mainnet'
 * @param {BigInt} oraclePrice 
 * @returns {Array<Object>} List of executable items
 */
async function getExecutableTrades(network, oraclePrice) {
  const trades = dbService.getTrades(network);
  const executable = [];

  for (const id in trades) {
    const t = trades[id];
    const state = Number(t.state);
    const direction = Number(t.direction);
    
    if (state === 0) { // STATE_ORDER (Pending Limit / Stop order)
      const orderType = Number(t.orderType);
      const targetPrice = BigInt(t.targetPrice);
      
      if (orderType === 1) { // ORDER_LIMIT
        // LONG limit: oraclePrice <= targetPrice
        // SHORT limit: oraclePrice >= targetPrice
        const ok = (direction === 1) ? (oraclePrice <= targetPrice) : (oraclePrice >= targetPrice);
        if (ok) {
          executable.push({
            tradeId: t.id,
            reason: 0,
            type: 'LIMIT'
          });
        }
      } else if (orderType === 2) { // ORDER_STOP
        // LONG stop: oraclePrice >= targetPrice
        // SHORT stop: oraclePrice <= targetPrice
        const ok = (direction === 1) ? (oraclePrice >= targetPrice) : (oraclePrice <= targetPrice);
        if (ok) {
          executable.push({
            tradeId: t.id,
            reason: 0,
            type: 'STOP'
          });
        }
      }
    } else if (state === 1) { // STATE_OPEN (Active Open Position)
      const liqPrice = BigInt(t.liqPrice);
      const stopLoss = BigInt(t.stopLoss);
      const takeProfit = BigInt(t.takeProfit);
      
      // 1. Check Liquidation (REASON_LIQ = 3)
      // LONG liq: oraclePrice <= liqPrice
      // SHORT liq: oraclePrice >= liqPrice
      const isLiq = (direction === 1) ? (oraclePrice <= liqPrice) : (oraclePrice >= liqPrice);
      if (isLiq) {
        executable.push({
          tradeId: t.id,
          reason: 3,
          type: 'LIQ'
        });
        continue; // Skip SL/TP checks if liquidation applies
      }
      
      // 2. Check Stop Loss (REASON_SL = 1)
      if (stopLoss > 0n) {
        // LONG SL: oraclePrice <= stopLoss
        // SHORT SL: oraclePrice >= stopLoss
        const isSL = (direction === 1) ? (oraclePrice <= stopLoss) : (oraclePrice >= stopLoss);
        if (isSL) {
          executable.push({
            tradeId: t.id,
            reason: 1,
            type: 'SL'
          });
          continue; // Skip TP check
        }
      }
      
      // 3. Check Take Profit (REASON_TP = 2)
      if (takeProfit > 0n) {
        // LONG TP: oraclePrice >= takeProfit
        // SHORT TP: oraclePrice <= takeProfit
        const isTP = (direction === 1) ? (oraclePrice >= takeProfit) : (oraclePrice <= takeProfit);
        if (isTP) {
          executable.push({
            tradeId: t.id,
            reason: 2,
            type: 'TP'
          });
          continue;
        }
      }
    }
  }

  return executable;
}

/**
 * Main Single Endpoint: POST /keeper
 * 
 * Handled in two modes:
 * 1. Read Mode:
 *    Body: { "price": "3360000", "network": "mainnet" }
 *    Returns: { "executable": [...] }
 * 
 * 2. Execution Mode:
 *    Body: { "execute": true, "pairIndexes": [5500], "network": "mainnet" }
 *    Fetches latest proofs, matches local executable conditions, submits to blockchain,
 *    and returns transaction hash, executed and skipped IDs.
 */
router.post('/', async (req, res) => {
  try {
    const { price, execute, pairIndexes } = req.body;
    const network = req.body.network || req.query.network || 'testnet'; // Read network, defaults to testnet

    if (!isNetworkConfigured(network)) {
      return res.status(400).json({ 
        error: `Requested network '${network}' is not fully configured in .env.` 
      });
    }

    // --- MODE 1: READ MODE (Lecture) ---
    if (price && !execute) {
      console.log(`[KeeperRoute] [${network.toUpperCase()}] Read Mode triggered with oracle price: ${price}`);
      const executable = await getExecutableTrades(network, BigInt(price));
      
      return res.json({
        executable: executable.map(item => ({
          tradeId: item.tradeId,
          reason: item.reason,
          type: item.type
        }))
      });
    }

    // --- MODE 2: EXECUTION MODE (Execution) ---
    if (execute) {
      const pairs = pairIndexes || [5500]; // Default to Gold (5500) if not provided
      console.log(`[KeeperRoute] [${network.toUpperCase()}] Execution Mode triggered for pairs: [${pairs.join(', ')}]`);

      // 1. Fetch Supra and KMS Proofs concurrently
      console.log(`[KeeperRoute] [${network.toUpperCase()}] Fetching oracle and risk proofs...`);
      const [supraProof, kmsProof] = await Promise.all([
        supraProofService.getSupraProof(pairs, network),
        kmsProofService.getKmsProof(network)
      ]);

      // 2. Query oracle price off the Supra proof using contract staticCall
      const coreContract = executeService.getContract(network);
      const provider = executeService.getProvider(network);
      
      if (!coreContract) {
        return res.status(500).json({ 
          error: `Keeper Signer / Contract not initialized for network ${network.toUpperCase()}. Verify PRIVATE_KEY or RPC_URL in .env.` 
        });
      }

      console.log(`[KeeperRoute] [${network.toUpperCase()}] Querying price from Supra proof via staticCall...`);
      const oracleAddress = await coreContract.oracle();
      const oracleAbi = [
        "function verifyOracleProofV2(bytes calldata _bytesProof) external returns (tuple(uint256[] pairs, uint256[] prices, uint256[] timestamp, uint256[] decimal, uint256[] round) info)"
      ];
      const oracleContract = new ethers.Contract(oracleAddress, oracleAbi, provider);
      
      const info = await oracleContract.verifyOracleProofV2.staticCall(supraProof);
      
      // Locate pair index inside proof (e.g. Gold is 5500)
      const primaryAssetId = pairs[0].toString();
      const assetIndex = info.pairs.findIndex(p => p.toString() === primaryAssetId);
      
      if (assetIndex === -1) {
        return res.status(400).json({ error: `Asset ID (${primaryAssetId}) not found in the verified Supra proof.` });
      }

      const rawPrice = info.prices[assetIndex];
      const decimals = info.decimal[assetIndex];
      const normalizedPrice = normalizePrice(rawPrice, decimals);
      console.log(`[KeeperRoute] [${network.toUpperCase()}] Oracle Price resolved: ${normalizedPrice.toString()} (Raw: ${rawPrice.toString()}, Decimals: ${decimals.toString()})`);

      // 3. Determine executable trades based on this price
      const executable = await getExecutableTrades(network, normalizedPrice);
      console.log(`[KeeperRoute] [${network.toUpperCase()}] Local check: found ${executable.length} executable trades.`);

      if (executable.length === 0) {
        console.log(`[KeeperRoute] [${network.toUpperCase()}] No trades meet execution thresholds. Skipping transaction.`);
        return res.json({
          txHash: null,
          executedIds: [],
          skippedIds: []
        });
      }

      // 4. Submit batch execution
      const tradeIds = executable.map(item => item.tradeId);
      const reasons = executable.map(item => item.reason);

      console.log(`[KeeperRoute] [${network.toUpperCase()}] Submitting batch execution to contract for trades: [${tradeIds.join(', ')}]...`);
      const result = await executeService.batchExecute(network, tradeIds, reasons, supraProof, kmsProof);

      // Return details
      return res.json({
        txHash: result.hash,
        executedIds: result.executedIds,
        skippedIds: result.skippedIds
      });
    }

    return res.status(400).json({ 
      error: 'Invalid request payload. Provide "price" (string/number) for Read Mode, or {"execute": true} for Execution Mode.' 
    });

  } catch (error) {
    console.error(`[KeeperRoute] [${network.toUpperCase()}] Exception in keeper endpoint:`, error);
    return res.status(500).json({ 
      error: error.message || 'Internal keeper backend error' 
    });
  }
});

module.exports = router;
