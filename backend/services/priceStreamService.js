const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config');
const socketService = require('./socketService');
const wsBridge = require('./wsBridge');

class PriceStreamService {
  constructor() {
    this.streamUrl = "https://benchmarks.pyth.network/v1/shims/tradingview/streaming";
    this.symbolsSet = new Set(config.symbols);
  }

  async start() {
    logger.info("Connexion au flux de prix Pyth...");
    
    try {
      const response = await axios({
        method: 'get',
        url: this.streamUrl,
        responseType: 'stream'
      });

      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const data = JSON.parse(line);
            
            // On filtre uniquement les symboles configurés
            if (this.symbolsSet.has(data.id)) {
              socketService.broadcast(data);
              
              // 🟢 Si c'est l'Or (XAU/USD), on alimente également le wsBridge (Supra WSS/REST) en fallback
              if (data.id === "Metal.XAU/USD") {
                wsBridge.updateXauPrice(data.p, data.t * 1000);
              }
            }
          } catch (e) {
            // Ligne incomplète ou invalide, on ignore
          }
        }
      });

      response.data.on('end', () => {
        logger.warn("Flux Pyth terminé, reconnexion dans 5s...");
        setTimeout(() => this.start(), 5000);
      });

      response.data.on('error', (err) => {
        logger.error(`Erreur Flux Pyth: ${err.message}`);
        setTimeout(() => this.start(), 5000);
      });

    } catch (err) {
      logger.error(`Impossible de se connecter au flux Pyth: ${err.message}`);
      setTimeout(() => this.start(), 5000);
    }
  }
}

module.exports = new PriceStreamService();
