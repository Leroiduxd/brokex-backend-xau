const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

// Ensure database directory exists
const dbDir = path.join(__dirname, '../database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'db.json');
const adapter = new FileSync(dbPath);
const db = low(adapter);

// Set defaults for LowDB as requested:
// Structure:
// {
//   "meta": {
//     "lastTradeId": 0
//   },
//   "trades": {}
// }
db.defaults({
  meta: {
    lastTradeId: 0
  },
  trades: {}
}).write();

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
    openInterest: t.openInterest ? t.openInterest.toString() : "0",
    targetPrice: t.targetPrice ? t.targetPrice.toString() : "0",
    openPrice: t.openPrice ? t.openPrice.toString() : "0",
    closePrice: t.closePrice ? t.closePrice.toString() : "0",
    stopLoss: t.stopLoss ? t.stopLoss.toString() : "0",
    takeProfit: t.takeProfit ? t.takeProfit.toString() : "0",
    liqPrice: t.liqPrice ? t.liqPrice.toString() : "0",
    maxProfit: t.maxProfit ? t.maxProfit.toString() : "0",
    openTimestamp: t.openTimestamp ? Number(t.openTimestamp.toString()) : 0,
    closeTimestamp: t.closeTimestamp ? Number(t.closeTimestamp.toString()) : 0
  };
}

module.exports = {
  /**
   * Retrieve the highest synchronized trade ID.
   * @returns {number}
   */
  getLastTradeId: () => {
    return db.get('meta.lastTradeId').value() || 0;
  },

  /**
   * Update the highest synchronized trade ID.
   * @param {number|string} id 
   */
  setLastTradeId: (id) => {
    db.set('meta.lastTradeId', Number(id)).write();
  },

  /**
   * Fetch a single trade by ID from db.json.
   * @param {number|string} id 
   * @returns {Object|undefined}
   */
  getTrade: (id) => {
    return db.get(`trades.${id}`).value();
  },

  /**
   * Fetch all trades from db.json.
   * @returns {Object} Keyed by ID string
   */
  getTrades: () => {
    return db.get('trades').value() || {};
  },

  /**
   * Save or update a single trade.
   * @param {number|string} id 
   * @param {Object} tradeData 
   */
  setTrade: (id, tradeData) => {
    const formatted = formatTrade(tradeData);
    db.set(`trades.${id}`, formatted).write();
  },

  /**
   * Save multiple trades in batch to optimize database writes.
   * Updates meta.lastTradeId accordingly.
   * @param {Array} tradesArray 
   */
  saveTradesBatch: (tradesArray) => {
    const tradesObj = db.get('trades').value() || {};
    let maxId = db.get('meta.lastTradeId').value() || 0;

    tradesArray.forEach(t => {
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
