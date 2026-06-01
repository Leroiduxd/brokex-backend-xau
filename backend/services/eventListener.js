const { ethers } = require('ethers');
const config = require('../config/config');
const coreAbi = require('../abi/coreAbi');
const syncService = require('./syncService');

const wsProviders = {};
const coreContractsWs = {};
const connectionStates = { testnet: false, mainnet: false };
const pingIntervals = {};

/**
 * Check if the given network is fully configured in .env.
 */
function isNetworkConfigured(network) {
  if (network === 'testnet') return true;
  return !!(config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS && config.mainnet.CORE_ADDRESS && config.mainnet.WS_URL);
}

/**
 * Initialize Ethers WebSocketProvider to listen to TradeEvent triggers in real-time.
 * Automatically handles reconnection and error recoveries.
 * Supports: startEventListener(network)
 * @param {string} network 'testnet' | 'mainnet'
 */
function startEventListener(network = 'testnet') {
  if (!isNetworkConfigured(network)) {
    console.log(`[EventListener] [${network.toUpperCase()}] Configuration is missing or incomplete. Skipping WebSocket listener.`);
    return;
  }

  const wsUrl = config[network].WS_URL;
  if (!wsUrl || wsUrl.startsWith('0x') || wsUrl === 'wss://rpc.testnet.pharolabs.xyz/ws') {
    console.warn(`[EventListener] [${network.toUpperCase()}] WS_URL is not configured. Skipping WebSocket listener setup.`);
    return;
  }

  if (connectionStates[network]) return;
  connectionStates[network] = true;

  console.log(`[EventListener] [${network.toUpperCase()}] Connecting to WS node at ${wsUrl}...`);

  try {
    const wsProvider = new ethers.WebSocketProvider(wsUrl);
    wsProviders[network] = wsProvider;
    
    const coreAddress = (config[network].CORE_ADDRESS || '').toLowerCase();
    const coreContractWs = new ethers.Contract(coreAddress, coreAbi, wsProvider);
    coreContractsWs[network] = coreContractWs;

    const websocket = wsProvider.websocket;
    
    websocket.on('open', async () => {
      console.log(`[EventListener] [${network.toUpperCase()}] WebSocket connection successfully established.`);
      connectionStates[network] = false;
      
      // Bind event logic
      setupTradeEventListener(network);

      // Perform a full check/sync to fill any missing gaps during downtime
      console.log(`[EventListener] [${network.toUpperCase()}] Re-syncing trade gaps post-reconnection...`);
      try {
        await syncService.performInitialSync(network);
      } catch (err) {
        console.error(`[EventListener] [${network.toUpperCase()}] Post-reconnection re-sync failed:`, err.message);
      }

      // Set up continuous heartbeat ping every 20 seconds to keep the RPC node connection alive
      if (pingIntervals[network]) clearInterval(pingIntervals[network]);
      pingIntervals[network] = setInterval(() => {
        if (websocket.readyState === 1) { // OPEN
          try {
            websocket.ping();
          } catch (e) {
            console.error(`[EventListener] [${network.toUpperCase()}] WebSocket heartbeat ping failed:`, e.message);
          }
        }
      }, 20000);
    });

    websocket.on('close', (code, reason) => {
      console.warn(`[EventListener] [${network.toUpperCase()}] WebSocket closed (Code: ${code}, Reason: ${reason}). Reconnecting in 5s...`);
      cleanup(network);
      setTimeout(() => startEventListener(network), 5000);
    });

    websocket.on('error', (error) => {
      console.error(`[EventListener] [${network.toUpperCase()}] WebSocket connection error:`, error.message);
      // close will trigger and retry
    });

  } catch (error) {
    console.error(`[EventListener] [${network.toUpperCase()}] Failed to initialize WebSocketProvider:`, error.message);
    connectionStates[network] = false;
    setTimeout(() => startEventListener(network), 5000);
  }
}

/**
 * Register listener for TradeEvent
 * @param {string} network
 */
function setupTradeEventListener(network) {
  const coreContractWs = coreContractsWs[network];
  if (!coreContractWs) return;

  console.log(`[EventListener] [${network.toUpperCase()}] Subscribed to BrokexCore:TradeEvent listener.`);
  
  coreContractWs.on('TradeEvent', async (tradeId) => {
    try {
      const tradeIdNum = Number(tradeId.toString());
      console.log(`[EventListener] [${network.toUpperCase()}] Real-time TradeEvent received for Trade ID: ${tradeIdNum}`);
      
      // Accelerate syncing by directly pulling the trade data from Lens
      await syncService.syncTradesByIds(network, [tradeIdNum]);
    } catch (err) {
      console.error(`[EventListener] [${network.toUpperCase()}] Error handling real-time TradeEvent:`, err.message);
    }
  });
}

/**
 * Destroy WS connections cleanly to prevent resource leaks
 * @param {string} network
 */
function cleanup(network) {
  connectionStates[network] = false;

  if (pingIntervals[network]) {
    clearInterval(pingIntervals[network]);
    delete pingIntervals[network];
  }
  
  const coreContractWs = coreContractsWs[network];
  if (coreContractWs) {
    try {
      coreContractWs.removeAllListeners('TradeEvent');
    } catch (e) {}
    delete coreContractsWs[network];
  }
  
  const wsProvider = wsProviders[network];
  if (wsProvider) {
    try {
      wsProvider.destroy();
    } catch (e) {}
    delete wsProviders[network];
  }
}

module.exports = {
  startEventListener
};
