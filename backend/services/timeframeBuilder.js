class TimeframeBuilder {
  /**
   * Construit une timeframe supérieure à partir des bougies 1m
   */
  build(m1Candles, targetTf) {
    if (!m1Candles || m1Candles.length === 0) return [];
    
    const tfMinutes = parseInt(targetTf);
    const tfSeconds = tfMinutes * 60;
    const grouped = {};

    m1Candles.forEach(c => {
      // Calcul du début de la bougie parente
      const groupTime = Math.floor(c.time / tfSeconds) * tfSeconds;
      
      if (!grouped[groupTime]) {
        grouped[groupTime] = {
          time: groupTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
          _m1Count: 1
        };
      } else {
        const g = grouped[groupTime];
        g.high = Math.max(g.high, c.high);
        g.low = Math.min(g.low, c.low);
        g.close = c.close;
        g.volume += (c.volume || 0);
        g._m1Count++;
      }
    });

    // On transforme l'objet en tableau trié
    return Object.values(grouped).sort((a, b) => a.time - b.time);
  }
}

module.exports = new TimeframeBuilder();
