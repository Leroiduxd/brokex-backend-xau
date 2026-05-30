const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

// Ensure database directory exists
const dbDir = path.join(__dirname, '../database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Database paths
const oldDbPath = path.join(dbDir, 'db.json');
const testnetDbPath = path.join(dbDir, 'db_testnet.json');
const mainnetDbPath = path.join(dbDir, 'db_mainnet.json');

// Proactive Migration: Copy old db.json to db_testnet.json if testnet doesn't exist yet
if (fs.existsSync(oldDbPath) && !fs.existsSync(testnetDbPath)) {
  try {
    fs.copyFileSync(oldDbPath, testnetDbPath);
    console.log(`[dbService] Successfully migrated legacy db.json to db_testnet.json`);
  } catch (err) {
    console.error(`[dbService] Legacy db.json migration failed:`, err.message);
  }
}

// Initialize LowDB adapters
const testnetAdapter = new FileSync(testnetDbPath);
const dbTestnet = low(testnetAdapter);
dbTestnet.defaults({
  meta: { lastTradeId: 0 },
  trades: {}
}).write();

const mainnetAdapter = new FileSync(mainnetDbPath);
const dbMainnet = low(mainnetAdapter);
dbMainnet.defaults({
  meta: { lastTradeId: 0 },
  trades: {}
}).write();

/**
 * Retrieve LowDB instance based on network name.
 * @param {string} network 'testnet' | 'mainnet'
 */
function getDb(network = 'testnet') {
  return network === 'mainnet' ? dbMainnet : dbTestnet;
}

/**
 * Convert ethers/solidity trade struct values into clean serializable JSON values.
 * Standardizes BigInt fields to String representation.
 */
function formatTrade(t) {
  return {
    id: t.id ? Number(t.id.toString()) : 0,
    trader: t.trader,
    state: t.state !== undefined ? Number(t.state.toString()) : 0,
    direction: t.direction !== undefined ? Number(t.direction.toString()) : 0,
    orderType: t.orderType !== undefined ? Number(t.orderType.toString()) : 0,
    margin: t.margin ? t.margin.toString() : "0",
    leverage: t.leverage ? Number(t.leverage.toString()) : 0,
    openInterest: (() => {
      if (t.openInterest) return t.openInterest.toString();
      const marginVal = t.margin ? BigInt(t.margin.toString()) : 0n;
      const leverageVal = t.leverage ? BigInt(t.leverage.toString()) : 0n;
      return (marginVal * leverageVal).toString();
    })(),
    targetPrice: t.targetPrice ? t.targetPrice.toString() : "0",
    openPrice: t.openPrice ? t.openPrice.toString() : "0",
    closePrice: t.closePrice ? t.closePrice.toString() : "0",
    stopLoss: t.stopLoss ? t.stopLoss.toString() : "0",
    takeProfit: t.takeProfit ? t.takeProfit.toString() : "0",
    liqPrice: (() => {
      if (t.liqPrice) return t.liqPrice.toString();
      const leverageVal = t.leverage ? BigInt(t.leverage.toString()) : 0n;
      if (leverageVal === 0n) return "0";
      const openPriceVal = t.openPrice && BigInt(t.openPrice.toString()) > 0n
        ? BigInt(t.openPrice.toString())
        : (t.targetPrice ? BigInt(t.targetPrice.toString()) : 0n);
      const direction = t.direction !== undefined ? Number(t.direction.toString()) : 0;
      const move = (openPriceVal * 900000n) / (leverageVal * 1000000n);
      if (direction === 1) {
        return (openPriceVal > move ? openPriceVal - move : 0n).toString();
      } else {
        return (openPriceVal + move).toString();
      }
    })(),
    maxProfit: t.maxProfit ? t.maxProfit.toString() : "0",
    openTimestamp: t.openTimestamp ? Number(t.openTimestamp.toString()) : 0,
    closeTimestamp: t.closeTimestamp ? Number(t.closeTimestamp.toString()) : 0
  };
}

module.exports = {
  /**
   * Retrieve the highest synchronized trade ID.
   * Supports signature: getLastTradeId(network)
   * @param {string} network 
   * @returns {number}
   */
  getLastTradeId: (network = 'testnet') => {
    const db = getDb(network);
    return db.get('meta.lastTradeId').value() || 0;
  },

  /**
   * Update the highest synchronized trade ID.
   * Supports: setLastTradeId(network, id) or legacy setLastTradeId(id) [defaults to testnet]
   * @param {string|number} networkOrId
   * @param {number|string} [id]
   */
  setLastTradeId: (networkOrId, id) => {
    let network = 'testnet';
    let targetId = networkOrId;
    if (networkOrId === 'testnet' || networkOrId === 'mainnet') {
      network = networkOrId;
      targetId = id;
    }
    const db = getDb(network);
    db.set('meta.lastTradeId', Number(targetId)).write();
  },

  /**
   * Fetch a single trade by ID from db.json.
   * Supports: getTrade(network, id) or legacy getTrade(id) [defaults to testnet]
   * @param {string|number} networkOrId
   * @param {number|string} [id]
   * @returns {Object|undefined}
   */
  getTrade: (networkOrId, id) => {
    let network = 'testnet';
    let targetId = networkOrId;
    if (networkOrId === 'testnet' || networkOrId === 'mainnet') {
      network = networkOrId;
      targetId = id;
    }
    const db = getDb(network);
    return db.get(`trades.${targetId}`).value();
  },

  /**
   * Fetch all trades from the database.
   * Supports: getTrades(network)
   * @param {string} network
   * @returns {Object} Keyed by ID string
   */
  getTrades: (network = 'testnet') => {
    const db = getDb(network);
    return db.get('trades').value() || {};
  },

  /**
   * Save or update a single trade.
   * Supports: setTrade(network, id, tradeData) or legacy setTrade(id, tradeData) [defaults to testnet]
   * @param {string|number} networkOrId
   * @param {number|string|Object} idOrTradeData
   * @param {Object} [tradeData]
   */
  setTrade: (networkOrId, idOrTradeData, tradeData) => {
    let network = 'testnet';
    let targetId = networkOrId;
    let data = idOrTradeData;
    if (networkOrId === 'testnet' || networkOrId === 'mainnet') {
      network = networkOrId;
      targetId = idOrTradeData;
      data = tradeData;
    }
    const db = getDb(network);
    const formatted = formatTrade(data);
    db.set(`trades.${targetId}`, formatted).write();
  },

  /**
   * Save multiple trades in batch to optimize database writes.
   * Updates meta.lastTradeId accordingly.
   * Supports: saveTradesBatch(network, tradesArray) or legacy saveTradesBatch(tradesArray) [defaults to testnet]
   * @param {string|Array} networkOrArray
   * @param {Array} [tradesArray]
   */
  saveTradesBatch: (networkOrArray, tradesArray) => {
    let network = 'testnet';
    let arr = networkOrArray;
    if (networkOrArray === 'testnet' || networkOrArray === 'mainnet') {
      network = networkOrArray;
      arr = tradesArray;
    }
    if (!Array.isArray(arr)) return;

    const db = getDb(network);
    const tradesObj = db.get('trades').value() || {};
    let maxId = db.get('meta.lastTradeId').value() || 0;

    arr.forEach(t => {
      if (!t || !t.id) return;
      const idStr = t.id.toString();
      const idNum = Number(idStr);
      if (idNum === 0) return; // Skip non-existent trades (returned as zeros by Solidity range query)
      
      tradesObj[idStr] = formatTrade(t);
      if (idNum > maxId) {
        maxId = idNum;
      }
    });

    db.set('trades', tradesObj).write();
    db.set('meta.lastTradeId', maxId).write();
  }
};
