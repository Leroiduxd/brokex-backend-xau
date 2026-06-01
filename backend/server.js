require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const config = require('./config/config');
const keeperRouter = require('./routes/keeper');
const syncService = require('./services/syncService');
const eventListener = require('./services/eventListener');
const triggerEngine = require('./services/triggerEngine');

// Import Chart routes and services
const candleRouter = require('./routes/candleRoutes');
const marketSummaryRouter = require('./routes/marketSummaryRoutes');
const proofRouter = require('./routes/proofRoutes');
const kmsRouter = require('./routes/kmsRoutes');
const socketService = require('./services/socketService');
const priceStreamService = require('./services/priceStreamService');
const chartSyncService = require('./services/chartSyncService');
const wsBridge = require('./services/wsBridge');
const pythPriceDiffService = require('./services/pythPriceDiffService');

const app = express();

// Premium CORS middleware to ensure seamless frontend communication
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'PUT, POST, PATCH, DELETE, GET');
    return res.status(200).json({});
  }
  next();
});

app.use(express.json());

// Keeper core endpoints
app.use('/keeper', keeperRouter);

app.use(candleRouter);
app.use(marketSummaryRouter);
app.use(proofRouter);
app.use(kmsRouter);

/**
 * Check if the given network is fully configured in .env.
 */
function isNetworkConfigured(network) {
  if (network === 'testnet') return true;
  return !!(config.mainnet.RPC_URL && config.mainnet.LENS_ADDRESS && config.mainnet.CORE_ADDRESS);
}

// Get all trades for a specific trader address (case-insensitive, testnet or mainnet)
app.get('/trades/:address', (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const network = req.query.network || 'testnet'; // Read network, defaults to testnet
    const dbService = require('./services/dbService');
    const trades = dbService.getTrades(network);
    const traderTrades = Object.values(trades).filter(
      t => t.trader && t.trader.toLowerCase() === address
    );
    res.json(traderTrades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get volume stats over the last 24h, last 7 days, all-time, and leverage metrics
app.get('/stats/volume', (req, res) => {
  try {
    const network = req.query.network || 'testnet'; // Read network, defaults to testnet
    const dbService = require('./services/dbService');
    const trades = dbService.getTrades(network);
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 24 * 3600;
    const oneWeekAgo = now - 7 * 24 * 3600;

    let volume24h = 0n;
    let volume7d = 0n;
    let allTimeVolume = 0n;

    let sumLeverageOpen = 0;
    let countLeverageOpen = 0;

    let sumLeverageHistorical = 0;
    let countLeverageHistorical = 0;

    Object.values(trades).forEach(t => {
      const state = Number(t.state);
      // Count only active (1) and closed (2) trades
      if (state === 1 || state === 2) {
        const oi = BigInt(t.openInterest || 0);
        const openTime = Number(t.openTimestamp);
        const closeTime = Number(t.closeTimestamp);
        const leverage = Number(t.leverage || 0);

        // 1. All-time Volume (Open + Close if state is closed)
        allTimeVolume += oi;
        if (state === 2) {
          allTimeVolume += oi;
        }

        // 2. 24 hours check
        if (openTime >= oneDayAgo) {
          volume24h += oi;
        }
        if (state === 2 && closeTime >= oneDayAgo) {
          volume24h += oi;
        }

        // 3. 7 days check
        if (openTime >= oneWeekAgo) {
          volume7d += oi;
        }
        if (state === 2 && closeTime >= oneWeekAgo) {
          volume7d += oi;
        }

        // 4. Leverage calculations
        sumLeverageHistorical += leverage;
        countLeverageHistorical++;

        if (state === 1) {
          sumLeverageOpen += leverage;
          countLeverageOpen++;
        }
      }
    });

    res.json({
      volume24h: {
        raw: volume24h.toString(),
        formatted: (Number(volume24h) / 1e6).toFixed(2)
      },
      volume7d: {
        raw: volume7d.toString(),
        formatted: (Number(volume7d) / 1e6).toFixed(2)
      },
      allTimeVolume: {
        raw: allTimeVolume.toString(),
        formatted: (Number(allTimeVolume) / 1e6).toFixed(2)
      },
      avgLeverageOpen: countLeverageOpen > 0 ? (sumLeverageOpen / countLeverageOpen).toFixed(2) : "0.00",
      avgLeverageHistorical: countLeverageHistorical > 0 ? (sumLeverageHistorical / countLeverageHistorical).toFixed(2) : "0.00",
      timestamp: now
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simple health/diagnostic status for both networks
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    testnet: {
      RPC_URL: config.testnet.RPC_URL,
      WS_URL: config.testnet.WS_URL,
      CORE_ADDRESS: config.testnet.CORE_ADDRESS,
      LENS_ADDRESS: config.testnet.LENS_ADDRESS,
      SIGNER_LOADED: !!config.testnet.PRIVATE_KEY && config.testnet.PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000'
    },
    mainnet: {
      configured: isNetworkConfigured('mainnet'),
      RPC_URL: config.mainnet.RPC_URL,
      WS_URL: config.mainnet.WS_URL,
      CORE_ADDRESS: config.mainnet.CORE_ADDRESS,
      LENS_ADDRESS: config.mainnet.LENS_ADDRESS,
      SIGNER_LOADED: !!config.mainnet.PRIVATE_KEY && config.mainnet.PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000'
    }
  });
});

const PORT = config.PORT || 3000;

// Start server and launch background jobs
const server = app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`  Brokex Unified Dual Keeper & Chart Backend on port ${PORT}`);
  console.log(`======================================================`);
  console.log(`* 🧪 [TESTNET] RPC:  ${config.testnet.RPC_URL}`);
  console.log(`* 🧪 [TESTNET] WS:   ${config.testnet.WS_URL}`);
  console.log(`* 🧪 [TESTNET] Core: ${config.testnet.CORE_ADDRESS}`);
  console.log(`======================================================`);
  if (isNetworkConfigured('mainnet')) {
    console.log(`* 🚀 [MAINNET] RPC:  ${config.mainnet.RPC_URL}`);
    console.log(`* 🚀 [MAINNET] WS:   ${config.mainnet.WS_URL}`);
    console.log(`* 🚀 [MAINNET] Core: ${config.mainnet.CORE_ADDRESS}`);
    console.log(`======================================================\n`);
  } else {
    console.log(`* 🚀 [MAINNET] Not configured or incomplete in .env.`);
    console.log(`======================================================\n`);
  }

  try {
    // 1. Boot up: perform initial trade sync up to highest block Trade ID for both environments (asynchronously)
    syncService.performInitialSync('testnet').catch(err => {
      console.error('[Server] Testnet initial sync failed:', err.message);
    });
    if (isNetworkConfigured('mainnet')) {
      syncService.performInitialSync('mainnet').catch(err => {
        console.error('[Server] Mainnet initial sync failed:', err.message);
      });
    }

    // 2. Schedule continuous safety check every 30 seconds (runs both internally)
    syncService.startPeriodicSync();

    // 3. Connect real-time WebSocket listeners
    eventListener.startEventListener('testnet');
    if (isNetworkConfigured('mainnet')) {
      eventListener.startEventListener('mainnet');
    }

    // 4. Start automated real-time price trigger engine (evaluates both internally)
    triggerEngine.startTriggerEngine();

    // 5. Start Supra WS Price stream & scheduler
    wsBridge.attachPriceWSS();
    wsBridge.rebalanceScheduler();

    // 6. Start Pyth live price stream
    priceStreamService.start();

    // 7. Start historical candle sync & build timeframes (non-blocking)
    chartSyncService.start().catch(err => console.error('[Server] ChartSyncService failed:', err));

    // 8. Start Pyth price differences hourly fetch & persist
    await pythPriceDiffService.start();

    console.log(`[Server] All dual-network subsystems started successfully!`);
  } catch (error) {
    console.error(`[Server] CRITICAL: Engine failed during startup sequence:`, error);
  }
});

// Initialize WebSocket server for Pyth live stream (socketService)
const pythWss = new WebSocketServer({ noServer: true });
socketService.init(pythWss);

// Handle upgrading of WebSocket protocols gracefully depending on pathname
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/ws/prices' || pathname === '/ws/gold' || pathname === '/ws/xau' || pathname === '/ws/spread' || pathname === '/ws/kms') {
    // Route to Supra WS Bridge
    wsBridge.handlePriceUpgrade(req, socket, head);
  } else if (pathname === '/' || pathname === '/ws/pyth' || pathname === '/pyth') {
    // Route to Pyth Socket Service
    pythWss.handleUpgrade(req, socket, head, (ws) => {
      pythWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});
