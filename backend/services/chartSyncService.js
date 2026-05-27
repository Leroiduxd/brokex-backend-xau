const config = require('../config');
const storageService = require('./storageService');
const pythService = require('./pythService');
const timeframeBuilder = require('./timeframeBuilder');
const logger = require('../utils/logger');

class ChartSyncService {
  constructor() {
    this.data = {}; // { "Symbol": [m1 candles] }
  }

  async start() {
    const startPoint = Math.floor(new Date(config.historyStartDate).getTime() / 1000);
    logger.info(`Démarrage du ChartSyncService (Source 1m, Début historique: ${config.historyStartDate})...`);
    
    for (const symbol of config.symbols) {
      // 1. Charger l'historique 1m existant
      let m1Candles = await storageService.load(symbol, "1");
      
      const now = Math.floor(Date.now() / 1000);

      // 2. Déterminer d'où on reprend le fetch (du plus ancien au plus récent)
      let from = startPoint;
      if (m1Candles.length > 0) {
        const lastTime = m1Candles[m1Candles.length - 1].time;
        // On reprend juste après la dernière bougie stockée
        from = Math.max(startPoint, lastTime + 1);
      }

      // 3. Récupérer les données manquantes (le loop dans pythService va du plus ancien au plus récent)
      if (from < now - 60) {
        logger.pyth(`Sync missing 1m pour ${symbol}...`);
        await pythService.fetchMissing1m(symbol, from, now);
        // Recharger après le fetch
        m1Candles = await storageService.load(symbol, "1");
      }

      this.data[symbol] = m1Candles;
      
      // 4. Générer toutes les timeframes
      await this.rebuildAndSaveAll(symbol);
    }

    this.startUpdateLoop();
    logger.success("Système de chart prêt et synchronisé.");
  }

  async rebuildAndSaveAll(symbol) {
    const m1 = this.data[symbol];
    if (!m1 || m1.length === 0) return;

    // On sauvegarde la source 1m complète
    await storageService.save(symbol, "1", m1);

    // On génère chaque timeframe demandée
    for (const tf of config.generatedTimeframes) {
      logger.info(`Génération locale de la timeframe ${tf}m pour ${symbol}...`);
      const generated = timeframeBuilder.build(m1, tf);
      await storageService.save(symbol, tf, generated);
    }
  }

  startUpdateLoop() {
    setInterval(async () => {
      const now = new Date();
      if (now.getSeconds() === 1) {
        await this.performUpdate();
      }
    }, 1000);
  }

  async performUpdate() {
    const nowTs = Math.floor(Date.now() / 1000);
    
    for (const symbol of config.symbols) {
      const m1 = this.data[symbol] || [];
      const from = m1.length > 0 ? m1[m1.length - 1].time + 1 : nowTs - 120;

      const newData = await pythService.get1mHistory(symbol, from, nowTs);
      
      if (newData && newData.length > 0) {
        this.data[symbol] = [...m1, ...newData];
        await this.rebuildAndSaveAll(symbol);
        logger.success(`Update live ${symbol} : +${newData.length} min.`);
      }
    }
  }
}

module.exports = new ChartSyncService();
