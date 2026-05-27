const logger = require('../utils/logger');
const config = require('../config');
const storageService = require('./storageService');

class SocketService {
  constructor() {
    this.wss = null;
    this.latestPrices = {}; // Cache des derniers prix
  }

  init(wss) {
    this.wss = wss;
    logger.success("Serveur WebSocket initialisé (Pyth live stream).");

    this.wss.on('connection', async (ws) => {
      // Au moment de la connexion, on envoie les derniers prix connus
      for (const symbol of config.symbols) {
        const priceData = await this.getLatestPrice(symbol);
        if (priceData) {
          ws.send(JSON.stringify(priceData));
        }
      }
    });
  }

  async getLatestPrice(symbol) {
    // Si on a un prix en cache (venant du stream live), on l'utilise
    if (this.latestPrices[symbol]) {
      return this.latestPrices[symbol];
    }

    // Sinon, on cherche dans le fichier 1m
    try {
      const candles = await storageService.load(symbol, "1");
      if (candles && candles.length > 0) {
        const last = candles[candles.length - 1];
        return {
          id: symbol,
          p: last.close,
          t: last.time,
          f: "t",
          s: 0
        };
      }
    } catch (e) {
      // Pas grave si on ne trouve rien
    }
    return null;
  }

  broadcast(priceData) {
    if (!this.wss) return;
    
    const message = JSON.stringify(priceData);
    this.latestPrices[priceData.id] = priceData;

    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) { // 1 = OPEN
        client.send(message);
      }
    });
  }
}

module.exports = new SocketService();
