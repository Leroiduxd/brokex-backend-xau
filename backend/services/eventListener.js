const { ethers } = require('ethers');
const config = require('../config/config');
const coreAbi = require('../abi/coreAbi');
const syncService = require('./syncService');

let wsProvider;
let coreContractWs;
let isConnecting = false;

/**
 * Initialize Ethers WebSocketProvider to listen to TradeEvent triggers in real-time.
 * Automatically handles reconnection and error recoveries.
 */
function startEventListener() {
  // Guard for missing or invalid WebSocket URLs
  if (!config.WS_URL || config.WS_URL.startsWith('0x') || config.WS_URL === 'wss://rpc.testnet.pharolabs.xyz/ws') {
    console.warn('[EventListener] WS_URL is not configured. Skipping WebSocket listener setup.');
    return;
  }

  if (isConnecting) return;
  isConnecting = true;

  console.log(`[EventListener] Connecting to WS node at ${config.WS_URL}...`);

  try {
    wsProvider = new ethers.WebSocketProvider(config.WS_URL);
    const coreAddress = (config.CORE_ADDRESS || '').toLowerCase();
    coreContractWs = new ethers.Contract(coreAddress, coreAbi, wsProvider);

    const websocket = wsProvider.websocket;
    
    websocket.on('open', () => {
      console.log('[EventListener] WebSocket connection successfully established.');
      isConnecting = false;
      
      // Bind event logic
      setupTradeEventListener();
    });

    websocket.on('close', (code, reason) => {
      console.warn(`[EventListener] WebSocket closed (Code: ${code}, Reason: ${reason}). Reconnecting in 5s...`);
      cleanup();
      setTimeout(startEventListener, 5000);
    });

    websocket.on('error', (error) => {
      console.error('[EventListener] WebSocket connection error:', error.message);
      // close will trigger and retry
    });

  } catch (error) {
    console.error('[EventListener] Failed to initialize WebSocketProvider:', error.message);
    isConnecting = false;
    setTimeout(startEventListener, 5000);
  }
}

/**
 * Register listener for TradeEvent
 */
function setupTradeEventListener() {
  if (!coreContractWs) return;

  console.log('[EventListener] Subscribed to BrokexCore:TradeEvent listener.');
  
  coreContractWs.on('TradeEvent', async (tradeId) => {
    try {
      const tradeIdNum = Number(tradeId.toString());
      console.log(`[EventListener] Real-time TradeEvent received for Trade ID: ${tradeIdNum}`);
      
      // Accelerate syncing by directly pulling the trade data from Lens
      await syncService.syncTradesByIds([tradeIdNum]);
    } catch (err) {
      console.error('[EventListener] Error handling real-time TradeEvent:', err.message);
    }
  });
}

/**
 * Destroy WS connections cleanly to prevent resource leaks
 */
function cleanup() {
  isConnecting = false;
  if (coreContractWs) {
    try {
      coreContractWs.removeAllListeners('TradeEvent');
    } catch (e) {}
    coreContractWs = null;
  }
  if (wsProvider) {
    try {
      wsProvider.destroy();
    } catch (e) {}
    wsProvider = null;
  }
}

module.exports = {
  startEventListener
};
