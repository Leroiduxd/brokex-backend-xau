const { ethers } = require('ethers');
const config = require('../config/config');
const lensAbi = require('../abi/lensAbi');
const dbService = require('./dbService');

// Initialize providers and contracts maps
const providers = {
  testnet: new ethers.JsonRpcProvider(config.testnet.RPC_URL),
  mainnet: config.mainnet.RPC_URL ? new ethers.JsonRpcProvider(config.mainnet.RPC_URL) : null
};

const lensContracts = {
  testnet: new ethers.Contract((config.testnet.LENS_ADDRESS || '').toLowerCase(), lensAbi, providers.testnet),
  mainnet: config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS 
    ? new ethers.Contract((config.mainnet.LENS_ADDRESS || '').toLowerCase(), lensAbi, providers.mainnet) 
    : null
};

/**
 * Check if the given network is fully configured in .env.
 */
function isNetworkConfigured(network) {
  if (network === 'testnet') return true;
  return !!(config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS && config.mainnet.CORE_ADDRESS);
}

/**
 * Sync ALL existing trades in the smart contract into lowdb on startup.
 * Supports signature: performInitialSync(network)
 * @param {string} network 'testnet' | 'mainnet'
 */
async function performInitialSync(network = 'testnet') {
  if (!isNetworkConfigured(network)) {
    console.log(`[SyncService] [${network.toUpperCase()}] Mainnet configuration not detected. Skipping initial sync.`);
    return;
  }

  const lensContract = lensContracts[network];
  console.log(`[SyncService] [${network.toUpperCase()}] Initializing trade synchronization...`);
  try {
    // 1. Get Protocol Snapshot to find lastTradeId
    const snapshot = await lensContract.getProtocolSnapshot();
    const lastTradeId = Number(snapshot.lastTradeId.toString());
    console.log(`[SyncService] [${network.toUpperCase()}] Lens Protocol Snapshot: lastTradeId = ${lastTradeId}`);

    const currentDbLastTradeId = dbService.getLastTradeId(network);
    console.log(`[SyncService] [${network.toUpperCase()}] Local Database state: lastTradeId = ${currentDbLastTradeId}`);

    if (lastTradeId === 0) {
      console.log(`[SyncService] [${network.toUpperCase()}] Protocol has 0 trades. Synchronization skipped.`);
      dbService.setLastTradeId(network, 0);
      return;
    }

    // Determine starting ID. Skip already synchronized trades to optimize time and network.
    const startId = currentDbLastTradeId + 1;
    if (startId > lastTradeId) {
      console.log(`[SyncService] [${network.toUpperCase()}] Local Database is up to date.`);
      dbService.setLastTradeId(network, lastTradeId);
      return;
    }

    console.log(`[SyncService] [${network.toUpperCase()}] Syncing trade IDs from ${startId} to ${lastTradeId}...`);
    
    // Batch retrieve trades (500 per batch)
    const BATCH_SIZE = 500;
    for (let currentId = startId; currentId <= lastTradeId; currentId += BATCH_SIZE) {
      const length = Math.min(BATCH_SIZE, lastTradeId - currentId + 1);
      console.log(`[SyncService] [${network.toUpperCase()}] Fetching trade range: startId = ${currentId}, length = ${length}`);
      
      const tradesBatch = await lensContract.getTradeRange(BigInt(currentId), BigInt(length));
      dbService.saveTradesBatch(network, tradesBatch);
    }

    dbService.setLastTradeId(network, lastTradeId);
    console.log(`[SyncService] [${network.toUpperCase()}] Initial synchronization complete. Total trades synced: ${lastTradeId}`);
  } catch (error) {
    console.error(`[SyncService] [${network.toUpperCase()}] Failed to complete initial sync:`, error.message);
  }
}

/**
 * Pull new trades since last sync using getProtocolSnapshot and getTradeRange.
 * Served as the periodic safety check if WebSocket events are missed.
 * Supports signature: checkAndSyncNewTrades(network)
 * @param {string} network 
 */
async function checkAndSyncNewTrades(network = 'testnet') {
  if (!isNetworkConfigured(network)) return;

  const lensContract = lensContracts[network];
  try {
    const snapshot = await lensContract.getProtocolSnapshot();
    const lastTradeId = Number(snapshot.lastTradeId.toString());
    const currentDbLastTradeId = dbService.getLastTradeId(network);

    if (lastTradeId > currentDbLastTradeId) {
      const count = lastTradeId - currentDbLastTradeId;
      console.log(`[SyncService] [${network.toUpperCase()}] Periodic sync: Found ${count} new trades. Syncing IDs ${currentDbLastTradeId + 1} to ${lastTradeId}...`);
      
      const BATCH_SIZE = 500;
      for (let currentId = currentDbLastTradeId + 1; currentId <= lastTradeId; currentId += BATCH_SIZE) {
        const length = Math.min(BATCH_SIZE, lastTradeId - currentId + 1);
        const tradesBatch = await lensContract.getTradeRange(BigInt(currentId), BigInt(length));
        dbService.saveTradesBatch(network, tradesBatch);
      }
      
      dbService.setLastTradeId(network, lastTradeId);
      console.log(`[SyncService] [${network.toUpperCase()}] Sync complete. DB updated to trade ID ${lastTradeId}`);
    } else {
      // Periodic sync also checks if we have any pending/open trades that may need updating.
      await syncActiveTradesState(network);
    }
  } catch (error) {
    console.error(`[SyncService] [${network.toUpperCase()}] Error during periodic sync check:`, error.message);
  }
}

/**
 * Extra safety check to synchronize the current states of active orders/positions in DB.
 * Supports signature: syncActiveTradesState(network)
 * @param {string} network
 */
async function syncActiveTradesState(network = 'testnet') {
  if (!isNetworkConfigured(network)) return;

  const lensContract = lensContracts[network];
  try {
    const trades = dbService.getTrades(network);
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
      dbService.saveTradesBatch(network, updatedTrades);
    }
  } catch (err) {
    console.error(`[SyncService] [${network.toUpperCase()}] Safety active state update failed:`, err.message);
  }
}

/**
 * Setup a continuous 30-second polling interval for checkAndSyncNewTrades.
 */
function startPeriodicSync() {
  console.log('[SyncService] Launching periodic synchronization (interval: 30 seconds) for all configured networks');
  setInterval(async () => {
    // 🧪 Sync Testnet
    await checkAndSyncNewTrades('testnet');
    
    // 🚀 Sync Mainnet if configured
    if (isNetworkConfigured('mainnet')) {
      await checkAndSyncNewTrades('mainnet');
    }
  }, 30000);
}

/**
 * Instantly sync specific trades from contract (triggered by WebSocket event).
 * Supports: syncTradesByIds(network, tradeIds) or legacy syncTradesByIds(tradeIds) [defaults to testnet]
 * @param {string|number[]} networkOrTradeIds
 * @param {number[]} [tradeIds]
 */
async function syncTradesByIds(networkOrTradeIds, tradeIds) {
  let network = 'testnet';
  let ids = networkOrTradeIds;
  if (networkOrTradeIds === 'testnet' || networkOrTradeIds === 'mainnet') {
    network = networkOrTradeIds;
    ids = tradeIds;
  }
  if (!isNetworkConfigured(network)) return;
  if (!ids || ids.length === 0) return;

  const lensContract = lensContracts[network];
  try {
    console.log(`[SyncService] [${network.toUpperCase()}] Direct fetch requested for trade IDs: [${ids.join(', ')}]`);
    const trades = await lensContract.getTradesByIds(ids.map(id => BigInt(id)));
    dbService.saveTradesBatch(network, trades);
  } catch (error) {
    console.error(`[SyncService] [${network.toUpperCase()}] Direct fetch failed for IDs [${ids.join(', ')}]:`, error.message);
  }
}

module.exports = {
  performInitialSync,
  checkAndSyncNewTrades,
  startPeriodicSync,
  syncTradesByIds,
  getLensContract: (network = 'testnet') => lensContracts[network]
};
