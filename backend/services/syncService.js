const { ethers } = require('ethers');
const config = require('../config/config');
const lensAbi = require('../abi/lensAbi');
const dbService = require('./dbService');

const provider = new ethers.JsonRpcProvider(config.RPC_URL);
const lensAddress = (config.LENS_ADDRESS || '').toLowerCase();
const lensContract = new ethers.Contract(lensAddress, lensAbi, provider);

/**
 * Sync ALL existing trades in the smart contract into lowdb on startup.
 */
async function performInitialSync() {
  console.log('[SyncService] Initializing trade synchronization...');
  try {
    // 1. Get Protocol Snapshot to find lastTradeId
    const snapshot = await lensContract.getProtocolSnapshot();
    const lastTradeId = Number(snapshot.lastTradeId.toString());
    console.log(`[SyncService] Lens Protocol Snapshot: lastTradeId = ${lastTradeId}`);

    const currentDbLastTradeId = dbService.getLastTradeId();
    console.log(`[SyncService] Local Database state: lastTradeId = ${currentDbLastTradeId}`);

    if (lastTradeId === 0) {
      console.log('[SyncService] Protocol has 0 trades. Synchronization skipped.');
      dbService.setLastTradeId(0);
      return;
    }

    // Determine starting ID. Skip already synchronized trades to optimize time and network.
    const startId = currentDbLastTradeId + 1;
    if (startId > lastTradeId) {
      console.log('[SyncService] Local Database is up to date.');
      dbService.setLastTradeId(lastTradeId);
      return;
    }

    console.log(`[SyncService] Syncing trade IDs from ${startId} to ${lastTradeId}...`);
    
    // Batch retrieve trades (500 per batch)
    const BATCH_SIZE = 500;
    for (let currentId = startId; currentId <= lastTradeId; currentId += BATCH_SIZE) {
      const length = Math.min(BATCH_SIZE, lastTradeId - currentId + 1);
      console.log(`[SyncService] Fetching trade range: startId = ${currentId}, length = ${length}`);
      
      const tradesBatch = await lensContract.getTradeRange(BigInt(currentId), BigInt(length));
      dbService.saveTradesBatch(tradesBatch);
    }

    dbService.setLastTradeId(lastTradeId);
    console.log(`[SyncService] Initial synchronization complete. Total trades synced: ${lastTradeId}`);
  } catch (error) {
    console.error('[SyncService] Failed to complete initial sync:', error.message);
  }
}

/**
 * Pull new trades since last sync using getProtocolSnapshot and getTradeRange.
 * Served as the periodic safety check if WebSocket events are missed.
 */
async function checkAndSyncNewTrades() {
  try {
    const snapshot = await lensContract.getProtocolSnapshot();
    const lastTradeId = Number(snapshot.lastTradeId.toString());
    const currentDbLastTradeId = dbService.getLastTradeId();

    if (lastTradeId > currentDbLastTradeId) {
      const count = lastTradeId - currentDbLastTradeId;
      console.log(`[SyncService] Periodic sync: Found ${count} new trades. Syncing IDs ${currentDbLastTradeId + 1} to ${lastTradeId}...`);
      
      const BATCH_SIZE = 500;
      for (let currentId = currentDbLastTradeId + 1; currentId <= lastTradeId; currentId += BATCH_SIZE) {
        const length = Math.min(BATCH_SIZE, lastTradeId - currentId + 1);
        const tradesBatch = await lensContract.getTradeRange(BigInt(currentId), BigInt(length));
        dbService.saveTradesBatch(tradesBatch);
      }
      
      dbService.setLastTradeId(lastTradeId);
      console.log(`[SyncService] Sync complete. DB updated to trade ID ${lastTradeId}`);
    } else {
      // Periodic sync also checks if we have any pending/open trades that may need updating.
      // Since states can change on-chain (e.g. executed or closed), we can sync states of all open/pending trades.
      // Let's do this as an extra layer of robust sync:
      await syncActiveTradesState();
    }
  } catch (error) {
    console.error('[SyncService] Error during periodic sync check:', error.message);
  }
}

/**
 * Extra safety check to synchronize the current states of active orders/positions in DB.
 */
async function syncActiveTradesState() {
  try {
    const trades = dbService.getTrades();
    const activeIds = Object.keys(trades).filter(id => {
      const state = Number(trades[id].state);
      return state === 0 || state === 1; // STATE_ORDER or STATE_OPEN
    }).map(Number);

    if (activeIds.length === 0) return;

    // Fetch the updated states/stops from contract in batches of 200
    const BATCH_SIZE = 200;
    for (let i = 0; i < activeIds.length; i += BATCH_SIZE) {
      const batchIds = activeIds.slice(i, i + BATCH_SIZE);
      const updatedTrades = await lensContract.getTradesByIds(batchIds.map(BigInt));
      dbService.saveTradesBatch(updatedTrades);
    }
  } catch (err) {
    console.error('[SyncService] Safety active state update failed:', err.message);
  }
}

/**
 * Setup a continuous 30-second polling interval for checkAndSyncNewTrades.
 */
function startPeriodicSync() {
  console.log('[SyncService] Launching periodic synchronization (interval: 30 seconds)');
  setInterval(async () => {
    await checkAndSyncNewTrades();
  }, 30000);
}

/**
 * Instantly sync a specific trade from contract (triggered by WebSocket event).
 * @param {number[]} tradeIds Array of trade IDs
 */
async function syncTradesByIds(tradeIds) {
  if (!tradeIds || tradeIds.length === 0) return;
  try {
    console.log(`[SyncService] Direct fetch requested for trade IDs: [${tradeIds.join(', ')}]`);
    const trades = await lensContract.getTradesByIds(tradeIds.map(id => BigInt(id)));
    dbService.saveTradesBatch(trades);
  } catch (error) {
    console.error(`[SyncService] Direct fetch failed for IDs [${tradeIds.join(', ')}]:`, error.message);
  }
}

module.exports = {
  performInitialSync,
  checkAndSyncNewTrades,
  startPeriodicSync,
  syncTradesByIds,
  getLensContract: () => lensContract
};
