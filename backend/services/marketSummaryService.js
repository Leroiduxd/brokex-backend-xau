const storageService = require('./storageService');
const config = require('../config');

class MarketSummaryService {
  async getSummary() {
    const summary = [];

    for (const symbol of config.symbols) {
      try {
        // On utilise le 15m comme source équilibrée pour les calculs
        const candles = await storageService.load(symbol, "15");
        
        if (!candles || candles.length === 0) continue;

        const currentPrice = candles[candles.length - 1].close;
        const nowTs = Math.floor(Date.now() / 1000);

        // Calculs des différences
        const hourPrice = this.getPriceAgo(candles, nowTs - 3600);
        const dayPrice = this.getPriceAgo(candles, nowTs - 86400);
        const weekPrice = this.getPriceAgo(candles, nowTs - 604800);

        summary.push({
          symbol: symbol,
          current_price: currentPrice,
          hour_price_diff_decimal: hourPrice ? (currentPrice - hourPrice) / hourPrice : 0,
          day_price_diff_decimal: dayPrice ? (currentPrice - dayPrice) / dayPrice : 0,
          week_price_diff_decimal: weekPrice ? (currentPrice - weekPrice) / weekPrice : 0,
          sparkline: this.generateSparkline(candles, 120)
        });
      } catch (err) {
        console.error(`Erreur summary pour ${symbol}:`, err.message);
      }
    }

    return summary;
  }

  /**
   * Trouve le prix le plus proche d'un timestamp donné
   */
  getPriceAgo(candles, targetTs) {
    // On cherche la bougie la plus proche (recherche binaire ou simple findLast pour la performance)
    const candle = candles.findLast(c => c.time <= targetTs);
    return candle ? candle.close : candles[0].close;
  }

  /**
   * Génère une sparkline échantillonnée
   */
  generateSparkline(candles, points) {
    if (candles.length <= points) {
      return candles.map(c => c.close);
    }

    // On prend les bougies des 7 derniers jours pour la sparkline
    const nowTs = Math.floor(Date.now() / 1000);
    const recentCandles = candles.filter(c => c.time >= nowTs - 604800);
    
    const source = recentCandles.length > points ? recentCandles : candles.slice(-points * 4);
    
    const result = [];
    const step = source.length / points;

    for (let i = 0; i < points; i++) {
      const index = Math.floor(i * step);
      result.push(source[index].close);
    }

    // On s'assure que le dernier point est le prix actuel
    result[result.length - 1] = source[source.length - 1].close;
    
    return result;
  }
}

module.exports = new MarketSummaryService();
